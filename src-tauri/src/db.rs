use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub struct Db(pub Arc<Mutex<Connection>>);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub note_id: String,
    pub text: String,
    pub checked: bool,
    pub sort_order: i64,
    pub updated_at: i64,
    /// 单次提醒时间(Unix 毫秒);NULL = 未设置,触发后由调度器清除
    pub remind_at: Option<i64>,
}

/// 到期待办(提醒调度扫描结果):笔记标题用于拼通知正文
#[derive(Clone)]
pub struct DueReminder {
    pub item_id: String,
    pub note_id: String,
    pub text: String,
    pub note_title: Option<String>,
    /// 扫描时看到的提醒时间:清除时以此做乐观锁,防止误删扫描后用户改设的新提醒
    pub remind_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub r#type: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub color: Option<String>,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteWithItems {
    #[serde(flatten)]
    pub note: Note,
    pub items: Vec<TodoItem>,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL DEFAULT 'note',
    title       TEXT,
    content     TEXT,
    color       TEXT,
    pinned      INTEGER NOT NULL DEFAULT 0,
    sort_weight REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
);

CREATE TABLE IF NOT EXISTS todo_items (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL REFERENCES notes(id),
    text       TEXT NOT NULL,
    checked    INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    remind_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at);
CREATE INDEX IF NOT EXISTS idx_todo_note ON todo_items(note_id, sort_order);
"#;

pub fn init(path: &std::path::Path) -> Result<Connection, rusqlite::Error> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    let conn = Connection::open(path)?;
    // WAL + NORMAL:写入不再整库阻塞;busy_timeout:遇到文件被占用(杀毒/同步软件)时等待而非立即失败
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    Ok(conn)
}

/// 存量库迁移:CREATE TABLE IF NOT EXISTS 不会给旧表加新列,这里按需补齐。
/// SQLite 没有 ADD COLUMN IF NOT EXISTS,先用 pragma_table_info 探测
fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_remind_at: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('todo_items') WHERE name = 'remind_at'",
        [],
        |r| r.get(0),
    )?;
    if has_remind_at == 0 {
        conn.execute_batch("ALTER TABLE todo_items ADD COLUMN remind_at INTEGER")?;
    }
    Ok(())
}

fn row_to_note(row: &rusqlite::Row) -> Result<Note, rusqlite::Error> {
    Ok(Note {
        id: row.get("id")?,
        r#type: row.get("type")?,
        title: row.get("title")?,
        content: row.get("content")?,
        color: row.get("color")?,
        pinned: row.get::<_, i64>("pinned")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn load_items(conn: &Connection, note_ids: &[String]) -> Result<std::collections::HashMap<String, Vec<TodoItem>>, rusqlite::Error> {
    let mut map: std::collections::HashMap<String, Vec<TodoItem>> = std::collections::HashMap::new();
    if note_ids.is_empty() {
        return Ok(map);
    }
    let placeholders = vec!["?"; note_ids.len()].join(",");
    let sql = format!(
        "SELECT id, note_id, text, checked, sort_order, updated_at, remind_at FROM todo_items WHERE note_id IN ({placeholders}) ORDER BY sort_order, updated_at"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(note_ids))?;
    while let Some(row) = rows.next()? {
        let item = TodoItem {
            id: row.get(0)?,
            note_id: row.get(1)?,
            text: row.get(2)?,
            checked: row.get::<_, i64>(3)? != 0,
            sort_order: row.get(4)?,
            updated_at: row.get(5)?,
            remind_at: row.get(6)?,
        };
        map.entry(item.note_id.clone()).or_default().push(item);
    }
    Ok(map)
}

pub fn list_notes(conn: &Connection) -> Result<Vec<NoteWithItems>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, type, title, content, color, pinned, created_at, updated_at
         FROM notes WHERE deleted_at IS NULL
         ORDER BY pinned DESC, created_at DESC",
    )?;
    let notes: Vec<Note> = stmt
        .query_map([], row_to_note)?
        .collect::<Result<_, _>>()?;
    let ids: Vec<String> = notes.iter().map(|n| n.id.clone()).collect();
    let mut items = load_items(conn, &ids)?;
    Ok(notes
        .into_iter()
        .map(|note| {
            let items = items.remove(&note.id).unwrap_or_default();
            NoteWithItems { note, items }
        })
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteInput {
    #[serde(default = "default_type")]
    pub r#type: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub color: Option<String>,
}

fn default_type() -> String {
    "note".into()
}

impl Default for CreateNoteInput {
    fn default() -> Self {
        Self { r#type: default_type(), title: None, content: None, color: None }
    }
}

pub fn create_note(conn: &Connection, input: &CreateNoteInput) -> Result<NoteWithItems, rusqlite::Error> {
    let t = now_ms();
    let note = Note {
        id: new_id(),
        r#type: if input.r#type == "todo" { "todo".into() } else { "note".into() },
        title: input.title.clone(),
        content: input.content.clone(),
        color: input.color.clone(),
        pinned: false,
        created_at: t,
        updated_at: t,
    };
    conn.execute(
        "INSERT INTO notes (id, type, title, content, color, pinned, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
        params![note.id, note.r#type, note.title, note.content, note.color, note.created_at],
    )?;
    Ok(NoteWithItems { note, items: Vec::new() })
}

// 区分「字段缺失(不修改)」与「显式 null(清空)」:
// 缺失 -> None,null -> Some(None),有值 -> Some(Some(v))
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(de).map(Some)
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteInput {
    #[serde(default, deserialize_with = "double_option")]
    pub title: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub content: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub color: Option<Option<String>>,
    #[serde(default)]
    pub pinned: Option<bool>,
}

pub fn update_note(conn: &Connection, id: &str, input: &UpdateNoteInput) -> Result<NoteWithItems, String> {
    let t = now_ms();
    let pinned_flag = input.pinned.map(|v| v as i64);
    let id_owned = id.to_string();
    let mut clauses = Vec::new();
    let mut values: Vec<&dyn rusqlite::ToSql> = Vec::new();

    if let Some(v) = input.title.as_ref() {
        clauses.push("title = ?".to_string());
        values.push(v);
    }
    if let Some(v) = input.content.as_ref() {
        clauses.push("content = ?".to_string());
        values.push(v);
    }
    if let Some(v) = input.color.as_ref() {
        clauses.push("color = ?".to_string());
        values.push(v);
    }
    if let Some(v) = pinned_flag.as_ref() {
        clauses.push("pinned = ?".to_string());
        values.push(v);
    }

    if clauses.is_empty() {
        return Err("NO_FIELDS_TO_UPDATE".into());
    }
    clauses.push("updated_at = ?".to_string());
    values.push(&t);
    values.push(&id_owned);
    let sql = format!(
        "UPDATE notes SET {} WHERE id = ? AND deleted_at IS NULL",
        clauses.join(", ")
    );
    let n = conn.execute(sql.as_str(), values.as_slice()).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("NOTE_NOT_FOUND".into());
    }
    get_note(conn, id).map_err(|e| e.to_string())
}

pub fn get_note(conn: &Connection, id: &str) -> Result<NoteWithItems, rusqlite::Error> {
    let note = conn
        .query_row(
            "SELECT id, type, title, content, color, pinned, created_at, updated_at
             FROM notes WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            row_to_note,
        )
        .optional()?
        .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
    let items = load_items(conn, std::slice::from_ref(&note.id))?
        .remove(note.id.as_str())
        .unwrap_or_default();
    Ok(NoteWithItems { note, items })
}

pub fn delete_note(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn
        .execute("UPDATE notes SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL", params![now_ms(), id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("NOTE_NOT_FOUND".into());
    }
    Ok(())
}

pub fn add_item(conn: &Connection, note_id: &str, text: &str) -> Result<TodoItem, String> {
    if text.trim().is_empty() {
        return Err("CONTENT_EMPTY".into());
    }
    let max_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM todo_items WHERE note_id = ?1",
            params![note_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let item = TodoItem {
        id: new_id(),
        note_id: note_id.to_string(),
        text: text.trim().to_string(),
        checked: false,
        sort_order: max_order + 1,
        updated_at: now_ms(),
        remind_at: None,
    };
    conn.execute(
        "INSERT INTO todo_items (id, note_id, text, checked, sort_order, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5)",
        params![item.id, item.note_id, item.text, item.sort_order, item.updated_at],
    )
    .map_err(|e| e.to_string())?;
    touch_note(conn, note_id)?;
    Ok(item)
}

pub fn update_item(conn: &Connection, id: &str, text: Option<&str>, checked: Option<bool>) -> Result<TodoItem, String> {
    let existing: Option<String> = conn
        .query_row("SELECT note_id FROM todo_items WHERE id = ?1", params![id], |r| r.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(note_id) = existing else {
        return Err("ITEM_NOT_FOUND".into());
    };
    if let Some(t) = text {
        if t.trim().is_empty() {
            return Err("CONTENT_EMPTY".into());
        }
        conn.execute("UPDATE todo_items SET text = ?1, updated_at = ?2 WHERE id = ?3", params![t.trim(), now_ms(), id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(c) = checked {
        // 完成即取消未触发的提醒(勾掉再取消勾选也不会弹出过期提醒)
        conn.execute(
            "UPDATE todo_items SET checked = ?1, remind_at = NULL, updated_at = ?2 WHERE id = ?3",
            params![c as i64, now_ms(), id],
        )
        .map_err(|e| e.to_string())?;
    }
    touch_note(conn, &note_id)?;
    query_item(conn, id)
}

/// 设置/清除待办项提醒(remind_at 为 None 表示清除),返回更新后的项。
/// 已完成项拒绝设提醒:due 扫描按 checked = 0 过滤,设了也永不触发,只留脏数据
pub fn set_reminder(conn: &Connection, id: &str, remind_at: Option<i64>) -> Result<TodoItem, String> {
    let row: Option<(String, bool)> = conn
        .query_row(
            "SELECT note_id, checked FROM todo_items WHERE id = ?1",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((note_id, checked)) = row else {
        return Err("ITEM_NOT_FOUND".into());
    };
    if checked && remind_at.is_some() {
        return Err("ITEM_CHECKED".into());
    }
    conn.execute(
        "UPDATE todo_items SET remind_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![remind_at, now_ms(), id],
    )
    .map_err(|e| e.to_string())?;
    touch_note(conn, &note_id)?;
    query_item(conn, id)
}

/// 提醒触发后清除该项提醒;expected 是扫描时的 remind_at 值,
/// 用户若在扫描与清除之间改设了新提醒,则不动并返回 false(下个周期不会再扫到旧值)
pub fn clear_due_reminder(conn: &Connection, id: &str, expected: i64) -> Result<bool, String> {
    let n = conn
        .execute(
            "UPDATE todo_items SET remind_at = NULL WHERE id = ?1 AND remind_at = ?2",
            params![id, expected],
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// 通知发送失败后回写提醒,下个周期重试:仅当 remind_at 仍为空(期间用户未改设新提醒)才恢复
pub fn restore_reminder(conn: &Connection, id: &str, expected: i64) -> Result<bool, String> {
    let n = conn
        .execute(
            "UPDATE todo_items SET remind_at = ?1 WHERE id = ?2 AND remind_at IS NULL",
            params![expected, id],
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// 最近的未触发提醒时间(未完成、所属笔记未软删除);没有任何待触发提醒时返回 None。
/// 调度线程据此计算精确的休眠截止时间,替代固定间隔轮询
pub fn next_remind_at(conn: &Connection) -> Result<Option<i64>, rusqlite::Error> {
    conn.query_row(
        "SELECT MIN(ti.remind_at) FROM todo_items ti
         JOIN notes n ON n.id = ti.note_id AND n.deleted_at IS NULL
         WHERE ti.remind_at IS NOT NULL AND ti.checked = 0",
        [],
        |r| r.get(0),
    )
}

/// 到期未完成的提醒(所属笔记未软删除)
pub fn due_reminders(conn: &Connection, now: i64) -> Result<Vec<DueReminder>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT ti.id, ti.note_id, ti.text, n.title, ti.remind_at
         FROM todo_items ti
         JOIN notes n ON n.id = ti.note_id AND n.deleted_at IS NULL
         WHERE ti.remind_at IS NOT NULL AND ti.remind_at <= ?1 AND ti.checked = 0
         ORDER BY ti.remind_at",
    )?;
    let rows = stmt.query_map(params![now], |row| {
        Ok(DueReminder {
            item_id: row.get(0)?,
            note_id: row.get(1)?,
            text: row.get(2)?,
            note_title: row.get(3)?,
            remind_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// 删除待办项,返回其所属笔记的 id(供跨窗口同步事件使用)
pub fn delete_item(conn: &Connection, id: &str) -> Result<String, String> {
    let note_id: Option<String> = conn
        .query_row("SELECT note_id FROM todo_items WHERE id = ?1", params![id], |r| r.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let n = conn.execute("DELETE FROM todo_items WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("ITEM_NOT_FOUND".into());
    }
    if let Some(nid) = &note_id {
        touch_note(conn, nid)?;
    }
    Ok(note_id.unwrap_or_default())
}

fn query_item(conn: &Connection, id: &str) -> Result<TodoItem, String> {
    conn.query_row(
        "SELECT id, note_id, text, checked, sort_order, updated_at, remind_at FROM todo_items WHERE id = ?1",
        params![id],
        |row| {
            Ok(TodoItem {
                id: row.get(0)?,
                note_id: row.get(1)?,
                text: row.get(2)?,
                checked: row.get::<_, i64>(3)? != 0,
                sort_order: row.get(4)?,
                updated_at: row.get(5)?,
                remind_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn touch_note(conn: &Connection, note_id: &str) -> Result<(), String> {
    conn.execute("UPDATE notes SET updated_at = ?1 WHERE id = ?2", params![now_ms(), note_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例独立的内存库,SCHEMA 与生产一致
    fn mem() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("init schema");
        conn
    }

    fn note_input(r#type: &str, title: Option<&str>) -> CreateNoteInput {
        CreateNoteInput {
            r#type: r#type.into(),
            title: title.map(Into::into),
            content: None,
            color: None,
        }
    }

    #[test]
    fn create_note_defaults_type_to_note() {
        let conn = mem();
        let n = create_note(&conn, &note_input("note", Some("t"))).unwrap();
        assert_eq!(n.note.r#type, "note");
        assert!(!n.note.pinned);
        assert!(n.items.is_empty());

        // 非法类型归一化为 note
        let weird = create_note(&conn, &note_input("diary", Some("d"))).unwrap();
        assert_eq!(weird.note.r#type, "note");

        let todo = create_note(&conn, &note_input("todo", None)).unwrap();
        assert_eq!(todo.note.r#type, "todo");
    }

    #[test]
    fn list_orders_by_pinned_then_created_at() {
        let conn = mem();
        let a = create_note(&conn, &note_input("note", Some("a"))).unwrap();
        let b = create_note(&conn, &note_input("note", Some("b"))).unwrap();
        let c = create_note(&conn, &note_input("todo", Some("c"))).unwrap();
        // 手工制造顺序差异:a 创建最新未置顶;b 创建最旧但置顶;
        // a 的 updated_at 更旧也不影响顺序(列表按 created_at 倒序)
        conn.execute("UPDATE notes SET created_at = 100 WHERE id = ?1", params![a.note.id])
            .unwrap();
        conn.execute("UPDATE notes SET created_at = 50 WHERE id = ?1", params![b.note.id])
            .unwrap();
        conn.execute("UPDATE notes SET updated_at = 999 WHERE id = ?1", params![b.note.id])
            .unwrap();
        conn.execute("UPDATE notes SET pinned = 1 WHERE id = ?1", params![b.note.id])
            .unwrap();
        let _ = c;

        let list = list_notes(&conn).unwrap();
        let ids: Vec<&str> = list.iter().map(|n| n.note.id.as_str()).collect();
        assert_eq!(ids, [b.note.id.as_str(), c.note.id.as_str(), a.note.id.as_str()]);
    }

    #[test]
    fn update_note_missing_field_is_error() {
        let conn = mem();
        let n = create_note(&conn, &note_input("note", Some("t"))).unwrap();
        let err = update_note(&conn, &n.note.id, &UpdateNoteInput::default()).unwrap_err();
        assert_eq!(err, "NO_FIELDS_TO_UPDATE");
    }

    #[test]
    fn update_note_nonexistent_id_is_error() {
        let conn = mem();
        let input = UpdateNoteInput {
            title: Some(Some("x".into())),
            ..Default::default()
        };
        let err = update_note(&conn, "no-such-id", &input).unwrap_err();
        assert_eq!(err, "NOTE_NOT_FOUND");
    }

    /// double_option 的核心语义:字段缺失(不动) / null(清空) / 有值(修改) 三态
    #[test]
    fn update_note_input_deserialization_triple_state() {
        let only_title: UpdateNoteInput = serde_json::from_str(r#"{"title":"新"}"#).unwrap();
        assert_eq!(only_title.title, Some(Some("新".into())));
        assert!(only_title.content.is_none());

        let null_content: UpdateNoteInput = serde_json::from_str(r#"{"content":null}"#).unwrap();
        assert_eq!(null_content.content, Some(None));

        let missing_content: UpdateNoteInput = serde_json::from_str(r#"{"title":"x"}"#).unwrap();
        assert!(missing_content.content.is_none());
    }

    #[test]
    fn update_note_applies_changes_and_bumps_updated_at() {
        let conn = mem();
        let n = create_note(&conn, &note_input("note", Some("old"))).unwrap();
        let input = UpdateNoteInput {
            title: Some(Some("new".into())),
            content: Some(None), // 显式清空
            ..Default::default()
        };
        let updated = update_note(&conn, &n.note.id, &input).unwrap();
        assert_eq!(updated.note.title.as_deref(), Some("new"));
        assert_eq!(updated.note.content, None);
        assert!(updated.note.updated_at >= n.note.updated_at);
    }

    #[test]
    fn delete_note_is_soft_and_idempotent_guarded() {
        let conn = mem();
        let n = create_note(&conn, &note_input("note", Some("t"))).unwrap();
        delete_note(&conn, &n.note.id).unwrap();

        // 软删除后:list 与 get 均不可见
        assert!(list_notes(&conn).unwrap().is_empty());
        assert!(get_note(&conn, &n.note.id).is_err());

        // 已删除再删 → 报错而非静默成功
        assert_eq!(delete_note(&conn, &n.note.id).unwrap_err(), "NOTE_NOT_FOUND");

        // 软删除的行仍在库里(deleted_at 有值)
        let deleted_at: Option<i64> = conn
            .query_row("SELECT deleted_at FROM notes WHERE id = ?1", params![n.note.id], |r| r.get(0))
            .unwrap();
        assert!(deleted_at.is_some());
    }

    #[test]
    fn add_item_appends_in_order_and_touches_note() {
        let conn = mem();
        let n = create_note(&conn, &note_input("todo", Some("t"))).unwrap();
        let before_updated = n.note.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(5));
        let i0 = add_item(&conn, &n.note.id, "第一项").unwrap();
        let i1 = add_item(&conn, &n.note.id, "第二项").unwrap();

        assert_eq!(i0.sort_order, 0);
        assert_eq!(i1.sort_order, 1);
        assert!(!i1.checked);

        // touch_note:待办项变更会刷新所属笔记的 updated_at
        let touched = get_note(&conn, &n.note.id).unwrap();
        assert!(touched.note.updated_at > before_updated);

        // 空文本拒绝
        assert_eq!(add_item(&conn, &n.note.id, "   ").unwrap_err(), "CONTENT_EMPTY");

        // 不存在的笔记:外键依赖由应用层保证,这里仍应失败于 touch_note
        assert!(add_item(&conn, "no-such-note", "x").is_err());
    }

    #[test]
    fn get_note_returns_items_sorted_by_sort_order() {
        let conn = mem();
        let n = create_note(&conn, &note_input("todo", None)).unwrap();
        let _ = add_item(&conn, &n.note.id, "b").unwrap();
        let _ = add_item(&conn, &n.note.id, "a").unwrap();
        let got = get_note(&conn, &n.note.id).unwrap();
        let texts: Vec<&str> = got.items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(texts, ["b", "a"]);
    }

    #[test]
    fn update_item_changes_text_and_checked() {
        let conn = mem();
        let n = create_note(&conn, &note_input("todo", None)).unwrap();
        let item = add_item(&conn, &n.note.id, "原始").unwrap();

        let updated = update_item(&conn, &item.id, Some("改过"), Some(true)).unwrap();
        assert_eq!(updated.text, "改过");
        assert!(updated.checked);

        // 不存在的项
        assert_eq!(update_item(&conn, "nope", Some("x"), None).unwrap_err(), "ITEM_NOT_FOUND");
        // 空文本拒绝
        assert_eq!(update_item(&conn, &item.id, Some("  "), None).unwrap_err(), "CONTENT_EMPTY");
    }

    #[test]
    fn delete_item_returns_note_id_and_touches_note() {
        let conn = mem();
        let n = create_note(&conn, &note_input("todo", None)).unwrap();
        let item = add_item(&conn, &n.note.id, "x").unwrap();
        let before = get_note(&conn, &n.note.id).unwrap().note.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(5));
        let owner = delete_item(&conn, &item.id).unwrap();
        assert_eq!(owner, n.note.id);
        assert!(get_note(&conn, &n.note.id).unwrap().note.updated_at > before);
        assert!(delete_item(&conn, &item.id).is_err());
    }

    #[test]
    fn set_reminder_sets_clears_and_rejects_missing_item() {
        let conn = mem();
        let n = create_note(&conn, &note_input("todo", None)).unwrap();
        let item = add_item(&conn, &n.note.id, "带提醒").unwrap();
        assert!(item.remind_at.is_none());

        let set = set_reminder(&conn, &item.id, Some(123_456_789)).unwrap();
        assert_eq!(set.remind_at, Some(123_456_789));

        let cleared = set_reminder(&conn, &item.id, None).unwrap();
        assert!(cleared.remind_at.is_none());

        assert_eq!(set_reminder(&conn, "nope", Some(1)).unwrap_err(), "ITEM_NOT_FOUND");
    }

    #[test]
    fn completing_item_cancels_pending_reminder() {
        let conn = mem();
        let n = create_note(&conn, &note_input("todo", None)).unwrap();
        let item = add_item(&conn, &n.note.id, "x").unwrap();
        set_reminder(&conn, &item.id, Some(now_ms() + 60_000)).unwrap();

        let done = update_item(&conn, &item.id, None, Some(true)).unwrap();
        assert!(done.checked);
        assert!(done.remind_at.is_none());
    }

    #[test]
    fn set_reminder_rejects_checked_item_but_allows_clear() {
        let conn = mem();
        let n = create_note(&conn, &note_input("todo", None)).unwrap();
        let item = add_item(&conn, &n.note.id, "x").unwrap();
        update_item(&conn, &item.id, None, Some(true)).unwrap();

        // 已完成项设提醒被拒:due 扫描按 checked = 0 过滤,设了也永不触发
        assert_eq!(
            set_reminder(&conn, &item.id, Some(now_ms() + 60_000)).unwrap_err(),
            "ITEM_CHECKED"
        );
        // 清除(置空)始终允许
        assert!(set_reminder(&conn, &item.id, None).is_ok());
    }

    #[test]
    fn due_reminders_filters_due_unchecked_and_live_notes() {
        let conn = mem();
        let note = create_note(&conn, &note_input("todo", Some("标题"))).unwrap();
        let due = add_item(&conn, &note.note.id, "到期").unwrap();
        let future = add_item(&conn, &note.note.id, "未到期").unwrap();
        let done = add_item(&conn, &note.note.id, "已完成").unwrap();
        set_reminder(&conn, &due.id, Some(500)).unwrap();
        set_reminder(&conn, &future.id, Some(999_999)).unwrap();
        set_reminder(&conn, &done.id, Some(100)).unwrap();
        update_item(&conn, &done.id, None, Some(true)).unwrap();

        let list = due_reminders(&conn, 1_000).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].item_id, due.id);
        assert_eq!(list[0].note_id, note.note.id);
        assert_eq!(list[0].text, "到期");
        assert_eq!(list[0].note_title.as_deref(), Some("标题"));

        // 乐观锁:remind_at 与扫描值一致才清除;用户改设新值后旧值清除不动
        assert!(clear_due_reminder(&conn, &due.id, 500).unwrap());
        set_reminder(&conn, &future.id, Some(999_999)).unwrap();
        assert!(!clear_due_reminder(&conn, &future.id, 123).unwrap());

        // 笔记被软删除后,其待办不再触发提醒
        set_reminder(&conn, &due.id, Some(100)).unwrap();
        delete_note(&conn, &note.note.id).unwrap();
        assert!(due_reminders(&conn, 1_000).unwrap().is_empty());
    }

    #[test]
    fn next_remind_at_returns_earliest_pending_only() {
        let conn = mem();
        // 无任何提醒时为 None
        assert_eq!(next_remind_at(&conn).unwrap(), None);

        let note = create_note(&conn, &note_input("todo", None)).unwrap();
        let later = add_item(&conn, &note.note.id, "晚").unwrap();
        let earlier = add_item(&conn, &note.note.id, "早").unwrap();
        let done = add_item(&conn, &note.note.id, "已完成").unwrap();
        set_reminder(&conn, &later.id, Some(2_000)).unwrap();
        assert_eq!(next_remind_at(&conn).unwrap(), Some(2_000));

        set_reminder(&conn, &earlier.id, Some(1_000)).unwrap();
        set_reminder(&conn, &done.id, Some(500)).unwrap();
        update_item(&conn, &done.id, None, Some(true)).unwrap();
        // 取最小值,已完成项的更早提醒不参与
        assert_eq!(next_remind_at(&conn).unwrap(), Some(1_000));

        // 软删除其所属笔记后不再计入
        delete_note(&conn, &note.note.id).unwrap();
        assert_eq!(next_remind_at(&conn).unwrap(), None);
    }

    #[test]
    fn restore_reminder_only_fills_empty_slot() {
        let conn = mem();
        let n = create_note(&conn, &note_input("todo", None)).unwrap();
        let item = add_item(&conn, &n.note.id, "x").unwrap();

        // remind_at 为空时恢复成功
        assert!(restore_reminder(&conn, &item.id, 1_234).unwrap());
        assert_eq!(query_item(&conn, &item.id).unwrap().remind_at, Some(1_234));

        // 已有值(用户改设了新提醒)时不覆盖
        set_reminder(&conn, &item.id, Some(9_999)).unwrap();
        assert!(!restore_reminder(&conn, &item.id, 1_234).unwrap());
        assert_eq!(query_item(&conn, &item.id).unwrap().remind_at, Some(9_999));
    }
}
