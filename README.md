# Juned Daily

Tasks, habits, money and journal in one app.

- **Today**: your day at a glance: today's tasks, habit check-ins, mood, and quick expense logging
- **Tasks**: one-time to-dos with due dates, plus routines that repeat daily or weekly
- **Habits**: daily check-offs with streaks and a 7-day history
- **Money**: expenses and income with categories, monthly totals and a breakdown by category
- **Journal**: mood, sleep, energy and notes for each day, saved as you type

It's plain HTML, CSS and JavaScript, with no build step and no dependencies. It works offline and can be installed to your home screen.

## Run it on your Mac

```bash
cd ~/Projects/daily-life
python3 -m http.server 5173
```

Then open http://localhost:5173.

## Use it on your phone

Host the folder on any free static host, such as **GitHub Pages**, **Netlify** or **Cloudflare Pages**. Open the URL on your phone and choose **Add to Home Screen**. It then opens like a normal app and works offline.

## Your data

All data is stored **only in the browser on the device you use**. It's private, but it doesn't sync between devices. Go to **⚙︎ Settings → Export backup** regularly. You can also use **Import backup** to move your data to another device.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell and bottom tab bar |
| `styles.css` | Styles (light and dark mode) |
| `app.js` | All app logic and screens |
| `sw.js` | Service worker that lets the app work offline |
| `manifest.json`, `icon.*` | Settings and icons for installing the app |
