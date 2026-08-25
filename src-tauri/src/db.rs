use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub struct Db(pub Mutex<Connection>);

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

pub fn delete_item(conn: &Connection, id: &str) -> Result<(), String> {
    let note_id: Option<String> = conn
        .query_row("SELECT note_id FROM todo_items WHERE id = ?1", params![id], |r| r.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let n = conn.execute("DELETE FROM todo_items WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("待办不存在".into());
    }
    if let Some(nid) = note_id {
        touch_note(conn, &nid)?;
    }
    Ok(())
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
