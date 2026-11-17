# Sonnad Studio

Online store for Books, T-Shirts and Business Packs.
Frontend: HTML, CSS and JavaScript. Backend: Node.js, Express and **MongoDB** (MongoDB Atlas).

## Run it

Needs Node.js 22 or newer and a MongoDB database (a free MongoDB Atlas cluster works).

1. Copy `backend/.env.example` to `backend/.env` and put your MongoDB Atlas link in `MONGODB_URI`.
2. Run:
   ```
   npm install
   npm start
   ```

- Store: http://localhost:3000
- Customer sign in: http://localhost:3000/login
- Admin panel: http://localhost:3000/admin (sign in at http://localhost:3000/admin/login)

`npm run dev` restarts the server automatically when you change a file.
`npm run reset-admin` sets the admin login to `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `backend/.env`.

Everything in the shop (products, categories, settings, policies, customers, orders, reviews)
is stored in MongoDB and managed from the admin panel. On a brand-new database only the admin account is created.

## Settings

`backend/.env` (private, never share it):

| Variable | What it does |
|---|---|
| `PORT` | Server port (default 3000) |
| `NODE_ENV` | Set to `production` when hosting over HTTPS (secure cookies) |
| `MONGODB_URI` | MongoDB connection link (MongoDB Atlas → Connect → Drivers) |
| `MONGODB_DB` | Database name (default `sonnad`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin login created on first run, or applied by `npm run reset-admin` |
| `SESSION_DAYS` | How many days people stay signed in (default 7) |

`frontend/.env` (public, sent to the browser as `window.ENV`; only names starting with `PUBLIC_`):

| Variable | What it does |
|---|---|
| `PUBLIC_API_URL` | API address; leave empty when the website and API run on the same server |

## Where things are stored

| What | Where |
|---|---|
| Products, categories, settings, users, sessions, carts, orders, reviews | MongoDB collections |
| Digital download files (book PDFs/EPUBs, pack ZIPs) | MongoDB (GridFS, `files` bucket); private, only sent after an order is confirmed |
| Product and banner pictures uploaded in admin | `frontend/uploads/` |

## Folders

```
backend/
  server.js        starts Express, serves /frontend and /api, /env.js
  env.js           loads backend/.env
  db.js            MongoDB connection, indexes, first admin account
  files.js         download files stored in MongoDB (GridFS)
  zipfiles.js      reads files inside ZIP packs
  auth.js          passwords, sessions, login checks
  validate.js      input checks
  routes/          catalog, auth, cart, orders, downloads, reviews, uploads, settings, admin
  scripts/
    reset-admin.js npm run reset-admin
frontend/
  index.html       store (home, product pages, cart, checkout, My Orders, My Downloads)
  login.html       customer sign in / create account
  admin.html       admin panel
  admin-login.html admin sign in
  css/style.css
  js/              api.js, app.js, admin.js, login.js, admin-login.js
```
