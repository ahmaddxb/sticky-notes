# My Sticky Notes - Sync Server API Documentation

The Sync Server provides a REST API for managing your sticky notes programmatically. All requests to the API (except authentication) require an **API Key** passed via a query parameter or the server dashboard.

## 🔑 Authentication

Most endpoints require a valid API Key.
- **Header**: None required (uses query params for simplicity)
- **Query Parameter**: `?key=YOUR_API_KEY`

---

## 📝 Endpoints summary

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/notes` | Get all notes for the current user | API Key |
| `GET` | `/api/notes/<id>` | Get a specific note by ID | API Key |
| `POST` | `/api/notes` | Create or update a note | API Key |
| `GET` | `/api/notes/<id>/lines` | Get note contents split into indexed lines | API Key |
| `POST` | `/api/notes/<id>/lines` | Append a new line or content to a note | API Key |
| `PATCH` | `/api/notes/<id>/lines/<index>` | Edit a specific line (0-indexed) | API Key |
| `DELETE` | `/api/notes/<id>` | Delete a specific note | API Key |
| `GET` | `/api/me` | Get current user info | Session |
| `POST` | `/api/me/password`| Change your password | Session |

---

## 🚀 Usage Examples

### 1. Fetch all notes
Returns an array of all notes synced to the server.
```bash
curl "https://nss.ahmaddxb.xyz/api/notes?key=YOUR_API_KEY"
```

### 2. Create or Update a note
Send a JSON object with the note content. If `id` is provided and exists, it updates; otherwise, it creates a new one.
```bash
curl -X POST "https://nss.ahmaddxb.xyz/api/notes?key=YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "My New Note",
       "content": "<h1>Hello World</h1><p>This was sent via API.</p>",
       "color": "#fff9c4"
     }'
```

### 3. Get indexed lines
Use this to find the `index` of a line you want to edit.
```bash
curl "https://nss.ahmaddxb.xyz/api/notes/NOTE_ID_HERE/lines?key=YOUR_API_KEY"
```

### 4. Append a new line
Appends content to the end of the note.
```bash
curl -X POST "https://nss.ahmaddxb.xyz/api/notes/NOTE_ID_HERE/lines?key=YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "content": "<div>Appended this awesome line</div>"
     }'
```

### 5. Edit a specific line
Target a specific line index (0-based) returned from the "Get indexed lines" endpoint.
```bash
curl -X PATCH "https://nss.ahmaddxb.xyz/api/notes/NOTE_ID_HERE/lines/1?key=YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "content": "<div>Updated existing line</div>"
     }'
```

### 6. Delete a note
```bash
curl -X DELETE "https://nss.ahmaddxb.xyz/api/notes/NOTE_ID_HERE?key=YOUR_API_KEY"
```

---

## 📊 Note Data Structure

A typical note object looks like this:

```json
{
  "id": "1773401098333",
  "name": "Project Ideas",
  "content": "Rich text content here...",
  "color": "#fff9c4",
  "x": 100,
  "y": 100,
  "width": 300,
  "height": 300,
  "updatedAt": "2026-03-14T12:00:00.000Z"
}
```

## 🛠️ Key Management

To generate a new API Key:
1. Visit [https://nss.ahmaddxb.xyz/dashboard.html](https://nss.ahmaddxb.xyz/dashboard.html)
2. Log in with your credentials.
3. Click **"+ Create New Key"**.
4. Use this key in the `?key=` parameter for your scripts.

## 🔒 Security Notes

- Keep your API Keys secret. Anyone with the key can read and modify your notes.
- Use HTTPS (`https://`) to ensure your keys and note data are encrypted during transit.
- If a key is compromised, you can delete it from the dashboard and generate a new one immediately.
