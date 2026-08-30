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
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
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
    Ok(conn)
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
        "SELECT id, note_id, text, checked, sort_order, updated_at FROM todo_items WHERE note_id IN ({placeholders}) ORDER BY sort_order, updated_at"
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
        };
        map.entry(item.note_id.clone()).or_default().push(item);
    }
    Ok(map)
}

pub fn list_notes(conn: &Connection) -> Result<Vec<NoteWithItems>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, type, title, content, color, pinned, created_at, updated_at
         FROM notes WHERE deleted_at IS NULL
         ORDER BY pinned DESC, updated_at DESC",
    )?;
    let notes: Vec<Note> = stmt
        .query_map([], |row| row_to_note(row))?
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
        return Err("没有需要更新的字段".into());
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
        return Err("便签不存在".into());
    }
    get_note(conn, id).map_err(|e| e.to_string())
}

pub fn get_note(conn: &Connection, id: &str) -> Result<NoteWithItems, rusqlite::Error> {
    let note = conn
        .query_row(
            "SELECT id, type, title, content, color, pinned, created_at, updated_at
             FROM notes WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| row_to_note(row),
        )
        .optional()?
        .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
    let items = load_items(conn, &[note.id.clone()])?
        .remove(note.id.as_str())
        .unwrap_or_default();
    Ok(NoteWithItems { note, items })
}

pub fn delete_note(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn
        .execute("UPDATE notes SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL", params![now_ms(), id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("便签不存在".into());
    }
    Ok(())
}

pub fn add_item(conn: &Connection, note_id: &str, text: &str) -> Result<TodoItem, String> {
    if text.trim().is_empty() {
        return Err("内容不能为空".into());
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
        return Err("待办不存在".into());
    };
    if let Some(t) = text {
        if t.trim().is_empty() {
            return Err("内容不能为空".into());
        }
        conn.execute("UPDATE todo_items SET text = ?1, updated_at = ?2 WHERE id = ?3", params![t.trim(), now_ms(), id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(c) = checked {
        conn.execute(
            "UPDATE todo_items SET checked = ?1, updated_at = ?2 WHERE id = ?3",
            params![c as i64, now_ms(), id],
        )
        .map_err(|e| e.to_string())?;
    }
    touch_note(conn, &note_id)?;
    query_item(conn, id)
}

/// 删除待办项,返回其所属笔记的 id(供跨窗口同步事件使用)
pub fn delete_item(conn: &Connection, id: &str) -> Result<String, String> {
    let note_id: Option<String> = conn
        .query_row("SELECT note_id FROM todo_items WHERE id = ?1", params![id], |r| r.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let n = conn.execute("DELETE FROM todo_items WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("待办不存在".into());
    }
    if let Some(nid) = &note_id {
        touch_note(conn, nid)?;
    }
    Ok(note_id.unwrap_or_default())
}

fn query_item(conn: &Connection, id: &str) -> Result<TodoItem, String> {
    conn.query_row(
        "SELECT id, note_id, text, checked, sort_order, updated_at FROM todo_items WHERE id = ?1",
        params![id],
        |row| {
            Ok(TodoItem {
                id: row.get(0)?,
                note_id: row.get(1)?,
                text: row.get(2)?,
                checked: row.get::<_, i64>(3)? != 0,
                sort_order: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn touch_note(conn: &Connection, note_id: &str) -> Result<(), String> {
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
    fn list_orders_by_pinned_then_updated_at() {
        let conn = mem();
        let a = create_note(&conn, &note_input("note", Some("a"))).unwrap();
        let b = create_note(&conn, &note_input("note", Some("b"))).unwrap();
        let c = create_note(&conn, &note_input("todo", Some("c"))).unwrap();
        // 手工制造顺序差异:a 最新未置顶;b 最旧但置顶
        conn.execute("UPDATE notes SET updated_at = 100 WHERE id = ?1", params![a.note.id])
            .unwrap();
        conn.execute("UPDATE notes SET updated_at = 50 WHERE id = ?1", params![b.note.id])
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
        assert_eq!(err, "没有需要更新的字段");
    }

    #[test]
    fn update_note_nonexistent_id_is_error() {
        let conn = mem();
        let input = UpdateNoteInput {
            title: Some(Some("x".into())),
            ..Default::default()
        };
        let err = update_note(&conn, "no-such-id", &input).unwrap_err();
        assert_eq!(err, "便签不存在");
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
        assert_eq!(delete_note(&conn, &n.note.id).unwrap_err(), "便签不存在");

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
        assert_eq!(add_item(&conn, &n.note.id, "   ").unwrap_err(), "内容不能为空");

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
        assert_eq!(update_item(&conn, "nope", Some("x"), None).unwrap_err(), "待办不存在");
        // 空文本拒绝
        assert_eq!(update_item(&conn, &item.id, Some("  "), None).unwrap_err(), "内容不能为空");
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
}
