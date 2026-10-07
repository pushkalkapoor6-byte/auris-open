# Auris Open – Tournament Portal

A free, mobile- and laptop-friendly portal for the **Auris Open**, the society tennis tournament of Auris Serenity Towers 1, 2 & 3.

**Live demo:** open `index.html` (or the GitHub Pages link) – it runs with sample data in your browser and resets on refresh.

| Login | Name | PIN |
|---|---|---|
| Admin | Admin | 1234 |
| Organiser | Meera | 7777 |
| Scorer | Ravi | 5555 |

Players don't log in – they register, pay and check their matches with their mobile number.

## Screens

| Laptop | Phone |
|---|---|
| ![Draws](screenshots/laptop-draws.jpg) | ![Home](screenshots/phone-home.jpg) |
| ![Matches](screenshots/laptop-matches.jpg) | ![Register](screenshots/phone-register.jpg) |
| ![Admin dashboard](screenshots/laptop-admin-dashboard.jpg) | ![Scorer](screenshots/phone-scorer.jpg) |

## What it does

**Players**
- Register for one or more categories (doubles partner details included) with tower, flat and playing history
- Pay by UPI (QR code with the amount filled in, plus screenshot upload) or choose Cash
- See draws, the order of play, results and their own entries and payment status

**Scorers** (phone view)
- Pick the winner and type the final score exactly as on the paper score card – any format (4-1, 7-5, 6-4 3-6 10-7), walkover or retired
- The winner moves to the next round automatically

**Organisers / Admin**
- Approve UPI payments or mark cash received – only approved entries go into the draws
- Seed players, generate knockout (with byes) or round-robin draws (with groups)
- Auto-schedule for the available courts and play days, with rest time between a player's matches; edit any time by hand
- Court-time check: warns when the matches won't fit the days available
- Accounts: entry fees counted automatically, plus income and expenses by head, balance
- Print referee score cards (two per A4), order of play, draw sheets, sign-in lists, accounts statement
- Export entries, matches, standings and accounts as CSV, or the whole database as Excel

## How the real version runs (₹0)

The live portal runs on one Google account: a **Google Sheet is the database** and **Google Apps Script** serves the web app. No hosting or paid services.

1. Create a Google Sheet, then **Extensions → Apps Script**.
2. Paste `apps-script/Code.gs` into `Code.gs`. Add an HTML file named `Index` and paste `apps-script/Index.html`.
3. Run `setup` once and allow the permissions (it builds all the tabs).
4. **Deploy → New deployment → Web app** – *Execute as:* Me, *Who has access:* Anyone. Share that URL.
5. Log in as Admin / 1234 and **change the PIN immediately** (the default is public in this repo). Then set the UPI ID, dates, fees and categories.

## Files

```
index.html            Clickable demo (sample data, runs fully in the browser)
apps-script/Code.gs   Backend for Google Apps Script
apps-script/Index.html Front end for Google Apps Script
screenshots/          Images used above
```

This repository holds code and made-up demo data only. Real player names, phone numbers and payments stay in the organisers' Google Sheet.
