# TrainWise

> **My first ever web development project.** Built when I barely knew what a REST API was. Keeping it here as a milestone — something to look back on and laugh at later.

---

## What It Is

TrainWise is a gym management system built with a vanilla HTML/CSS/JS frontend and a Node.js + Express backend connected to a Microsoft SQL Server database.

It handles the core operations you'd expect from a gym platform — managing members, trainers, workout sessions, bookings, attendance, equipment, payments, and inventory. There's a role-based system with three user types: **Members**, **Trainers**, and **Admins**, each with their own dashboard and permissions.

---

## Features

- **Auth** — JWT-based login and signup with bcrypt password hashing
- **Role-based access** — admin-only routes protected via middleware
- **Members** — register, view dashboard, track attendance and membership status
- **Trainers** — manage specializations and schedules
- **Workout Sessions** — create and book sessions with trainers
- **Equipment & Inventory** — track gym equipment and product stock
- **Sales & Expenses** — basic financial records
- **Suppliers** — manage product suppliers
- **Payment History** — log and retrieve member payments

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | HTML, CSS, JavaScript (vanilla) |
| Backend | Node.js, Express |
| Database | Microsoft SQL Server (mssql) |
| Auth | JWT + bcryptjs |

---

## Project Structure

```
TrainWise/
├── Frontend/        # Vanilla HTML/CSS/JS pages
├── Backend/         # Express server + all API routes
├── Project.sql      # Database schema and setup
└── .gitignore
```

---

## Getting Started

1. Clone the repo
2. Set up your SQL Server database using `Project.sql`
3. Create a `.env` file in the Backend folder:

```
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_SERVER=your_server
DB_DATABASE=your_database
DB_PORT=1433
JWT_SECRET=your_jwt_secret
```

4. Install dependencies and run:

```bash
cd Backend
npm install
node server.js
```

5. Open `http://localhost:3000` in your browser

---

## Honest Notes

This was written before I knew about proper project structure, query abstraction, environment safety, or separation of concerns. The entire backend lives in a single `server.js` file. Some routes use parameterized queries, some don't. The frontend is three folders of raw HTML files.

It works. It was a good starting point. That's enough.

---

*First project. Everyone has one.*
