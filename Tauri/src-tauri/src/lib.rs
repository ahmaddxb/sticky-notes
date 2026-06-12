use tauri::{AppHandle, Manager, WebviewWindowBuilder, WebviewUrl, State};
use std::sync::Mutex;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Note {
    pub id: String,
    pub content: String,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WindowLayout {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub is_open: Option<bool>,
}

pub struct AppState {
    pub notes: Mutex<Vec<Note>>,
    pub layout: Mutex<HashMap<String, WindowLayout>>,
    pub notes_file: PathBuf,
    pub layout_file: PathBuf,
}

#[tauri::command]
fn log_server(msg: String) {
    println!("[Renderer] {}", msg);
}

#[tauri::command]
fn request_note_hydration(id: String, state: State<'_, AppState>) -> Result<Note, String> {
    let notes = state.notes.lock().map_err(|e| e.to_string())?;
    notes.iter()
        .find(|n| n.id == id)
        .cloned()
        .ok_or_else(|| "Note not found".to_string())
}

#[tauri::command]
fn save_content(id: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.content = content;
    }
    save_notes_to_disk(&notes, &state.notes_file)?;
    Ok(())
}

#[tauri::command]
fn save_name(id: String, name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.name = name;
    }
    save_notes_to_disk(&notes, &state.notes_file)?;
    Ok(())
}

#[tauri::command]
fn new_note(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    new_note_internal(app, state)
}

fn new_note_internal(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let id = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
    let note = Note {
        id: id.clone(),
        content: String::new(),
        name: String::new(),
    };

    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    notes.push(note.clone());
    save_notes_to_disk(&notes, &state.notes_file)?;

    let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
    let new_layout = WindowLayout {
        x: None,
        y: None,
        width: Some(320.0),
        height: Some(380.0),
        is_open: Some(true),
    };
    layout.insert(id.clone(), new_layout.clone());
    save_layout_to_disk(&layout, &state.layout_file)?;

    create_note_window(&app, &note, &new_layout)?;
    Ok(())
}

#[tauri::command]
fn close_note(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
    if let Some(l) = layout.get_mut(&id) {
        l.is_open = Some(false);
    }
    save_layout_to_disk(&layout, &state.layout_file)?;

    if let Some(win) = app.get_webview_window(&format!("note-{}", id)) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_note_permanent(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    notes.retain(|n| n.id != id);
    save_notes_to_disk(&notes, &state.notes_file)?;

    let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
    layout.remove(&id);
    save_layout_to_disk(&layout, &state.layout_file)?;

    if let Some(win) = app.get_webview_window(&format!("note-{}", id)) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_window(id: String, width: f64, height: f64, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&format!("note-{}", id)) {
        win.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height })).map_err(|e| e.to_string())?;
        
        let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
        if let Some(l) = layout.get_mut(&id) {
            l.width = Some(width);
            l.height = Some(height);
        }
        save_layout_to_disk(&layout, &state.layout_file)?;
    }
    Ok(())
}

fn save_notes_to_disk(notes: &[Note], path: &std::path::Path) -> Result<(), String> {
    let json = serde_json::to_string_pretty(notes).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn save_layout_to_disk(layout: &HashMap<String, WindowLayout>, path: &std::path::Path) -> Result<(), String> {
    let json = serde_json::to_string_pretty(layout).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn create_note_window(app: &AppHandle, note: &Note, layout: &WindowLayout) -> Result<(), String> {
    let label = format!("note-{}", note.id);
    let width = layout.width.unwrap_or(320.0);
    let height = layout.height.unwrap_or(380.0);

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(&note.name)
        .inner_size(width, height)
        .min_inner_size(200.0, 200.0)
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .always_on_top(false)
        .skip_taskbar(true);

    if let (Some(x), Some(y)) = (layout.x, layout.y) {
        // We will validate if coordinates are visible. If not, fallback will happen in setup or during creation
        builder = builder.position(x as f64, y as f64);
    }

    let win = builder.build().map_err(|e| e.to_string())?;
    
    // Listen to move/resize to save bounds
    let id_clone = note.id.clone();
    let app_clone = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(pos) = event {
            let state = app_clone.state::<AppState>();
            if let Ok(mut layout) = state.layout.lock() {
                if let Some(l) = layout.get_mut(&id_clone) {
                    l.x = Some(pos.x);
                    l.y = Some(pos.y);
                }
                let _ = save_layout_to_disk(&layout, &state.layout_file);
            }
        } else if let tauri::WindowEvent::Resized(size) = event {
            let state = app_clone.state::<AppState>();
            if let Ok(mut layout) = state.layout.lock() {
                if let Some(l) = layout.get_mut(&id_clone) {
                    l.width = Some(size.width as f64);
                    l.height = Some(size.height as f64);
                }
                let _ = save_layout_to_disk(&layout, &state.layout_file);
            }
        }
    });

    Ok(())
}

fn toggle_all_windows(app: &AppHandle) {
    let windows = app.webview_windows();
    let mut any_visible = false;
    for win in windows.values() {
        if let Ok(true) = win.is_visible() {
            any_visible = true;
            break;
        }
    }
    for win in windows.values() {
        if any_visible {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

fn recenter_all_windows(app: &AppHandle) -> Result<(), String> {
    let windows = app.webview_windows();
    let mut monitor = None;
    for win in windows.values() {
        if let Ok(Some(m)) = win.primary_monitor() {
            monitor = Some(m);
            break;
        }
    }
    
    let monitor = match monitor {
        Some(m) => m,
        None => return Err("No active monitor detected".to_string()),
    };
    
    let position = monitor.position();
    let size = monitor.size();
    
    let work_x = position.x;
    let work_y = position.y;
    let work_w = size.width as i32;
    let work_h = size.height as i32;
    
    let mut index = 0;
    let state = app.state::<AppState>();
    let mut layout = state.layout.lock().map_err(|e| e.to_string())?;

    for (label, win) in windows {
        if label.starts_with("note-") {
            let note_id = label.replace("note-", "");
            let width = layout.get(&note_id).and_then(|l| l.width).unwrap_or(320.0);
            let height = layout.get(&note_id).and_then(|l| l.height).unwrap_or(380.0);
            
            let offset = index * 30;
            let x = work_x + (work_w - width as i32) / 2 + offset;
            let y = work_y + (work_h - height as i32) / 2 + offset;
            
            win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y })).map_err(|e| e.to_string())?;
            win.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height })).map_err(|e| e.to_string())?;
            
            if let Some(l) = layout.get_mut(&note_id) {
                l.x = Some(x);
                l.y = Some(y);
            }
            index += 1;
        }
    }
    
    save_layout_to_disk(&layout, &state.layout_file)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
            fs::create_dir_all(&app_data).unwrap();

            let notes_file = app_data.join("notes.json");
            let layout_file = app_data.join("layout.json");

            let mut notes: Vec<Note> = if notes_file.exists() {
                let data = fs::read_to_string(&notes_file).unwrap();
                serde_json::from_str(&data).unwrap_or_default()
            } else {
                Vec::new()
            };

            let mut layout: HashMap<String, WindowLayout> = if layout_file.exists() {
                let data = fs::read_to_string(&layout_file).unwrap();
                serde_json::from_str(&data).unwrap_or_default()
            } else {
                HashMap::new()
            };

            // Seed initial note if none exists
            if notes.is_empty() {
                let id = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
                notes.push(Note {
                    id: id.clone(),
                    content: String::new(),
                    name: String::new(),
                });
                layout.insert(id, WindowLayout {
                    x: None,
                    y: None,
                    width: Some(320.0),
                    height: Some(380.0),
                    is_open: Some(true),
                });
                let _ = save_notes_to_disk(&notes, &notes_file);
                let _ = save_layout_to_disk(&layout, &layout_file);
            }

            // Inject state
            app.manage(AppState {
                notes: Mutex::new(notes.clone()),
                layout: Mutex::new(layout.clone()),
                notes_file,
                layout_file,
            });

            // Create tray icon
            let new_note_item = MenuItem::with_id(app, "new_note", "New Note", true, None::<&str>).unwrap();
            let show_hide_item = MenuItem::with_id(app, "show_hide", "Show/Hide All Windows", true, None::<&str>).unwrap();
            let recenter_item = MenuItem::with_id(app, "recenter", "Recenter All Notes", true, None::<&str>).unwrap();
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).unwrap();

            let menu = Menu::with_items(app, &[
                &new_note_item,
                &show_hide_item,
                &recenter_item,
                &quit_item,
            ]).unwrap();

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "new_note" => {
                            let state = app.state::<AppState>();
                            let _ = new_note_internal(app.clone(), state);
                        }
                        "show_hide" => {
                            toggle_all_windows(app);
                        }
                        "recenter" => {
                            let _ = recenter_all_windows(app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|app, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        toggle_all_windows(app);
                    }
                })
                .build(app)
                .unwrap();

            // Create initial windows
            let app_handle = app.handle();
            for note in &notes {
                if let Some(l) = layout.get(&note.id) {
                    if l.is_open.unwrap_or(true) {
                        let _ = create_note_window(app_handle, note, l);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_server,
            request_note_hydration,
            save_content,
            save_name,
            new_note,
            close_note,
            delete_note_permanent,
            resize_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
