# WorkOutProNow στο iPhone — Πλάνο προσωπικής χρήσης

Στόχος: να τρέχει η εφαρμογή στο iPhone σου **σαν κανονικό app** (εικονίδιο,
fullscreen, offline logging) **χωρίς App Store και χωρίς Apple Developer
Program ($99)**. Τα δεδομένα μένουν στο Mac σου (PostgreSQL) — τίποτα δεν
ανεβαίνει σε cloud.

## Γιατί PWA και όχι native build

| Δρόμος                             | Κόστος    | Συντήρηση                     | Πότε αξίζει                               |
| ---------------------------------- | --------- | ----------------------------- | ----------------------------------------- |
| **PWA install (προτεινόμενο)**     | €0        | καμία                         | Προσωπική χρήση — αυτό το πλάνο           |
| Capacitor + free Apple ID sideload | €0        | re-sign κάθε 7 μέρες με Xcode | Μόνο αν θες native APIs (HealthKit κ.λπ.) |
| Capacitor + Developer Program      | $99/χρόνο | ετήσιο cert                   | Μόνο για διανομή/TestFlight               |

Το app είναι ήδη installable PWA (manifest + service worker + offline queue),
οπότε ο PWA δρόμος δίνει το 100% της λειτουργικότητας με μηδέν κόστος.

## Αρχιτεκτονική

```
iPhone (Safari PWA) ──HTTPS──▶ Mac: client app :3000 ──▶ /api proxy
                                        ├─▶ identity-service :4001
                                        ├─▶ user-profile-service :4002
                                        └─▶ engine-service :4003 ──▶ PostgreSQL 16
```

Μόνο η **:3000** χρειάζεται να είναι προσβάσιμη από το iPhone — ο proxy
αναλαμβάνει τα υπόλοιπα.

---

## Φάση 1 — iOS πολιτότητα του PWA (~30΄, μία φορά)

Το iOS θέλει μερικά extras που το Android δεν χρειάζεται:

1. **PNG εικονίδια** (το iOS αγνοεί το SVG για home screen):
   - `apple-touch-icon.png` 180×180 στο `apps/client/public/`
   - 192×192 και 512×512 εικονίδια δηλωμένα στο `manifest.webmanifest`
2. **Meta tags** στο `index.html`:
   ```html
   <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
   <meta name="apple-mobile-web-app-capable" content="yes" />
   <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
   ```
3. **`display: "standalone"`** στο manifest (έλεγχος ότι υπάρχει ήδη).
4. Safe-area padding για το notch: `env(safe-area-inset-*)` στο tab bar CSS
   (το `viewport-fit=cover` υπάρχει ήδη).

## Φάση 2 — Δικτύωση: πώς βλέπει το iPhone το Mac

**Επιλογή A — Tailscale (προτεινόμενο, €0):** δουλεύει **και εκτός σπιτιού**
(γυμναστήριο!), με πραγματικό HTTPS ώστε ο service worker / offline queue να
λειτουργούν πλήρως.

1. Εγκατέστησε Tailscale σε Mac + iPhone (App Store, δωρεάν personal tier),
   login με το ίδιο account.
2. Στο Mac: `tailscale serve --bg 3000` → δίνει URL τύπου
   `https://mac-name.tailXXXX.ts.net` με έγκυρο πιστοποιητικό.
3. Το iPhone ανοίγει αυτό το URL από παντού — χωρίς port forwarding,
   χωρίς έκθεση στο internet.

**Επιλογή B — Τοπικό δίκτυο μόνο (0 setup):** Safari →
`http://192.168.68.52:3000` (τρέχον IP του Mac — μπορεί να αλλάζει· κλείδωσέ
το στο router ως static). Περιορισμός: πάνω από HTTP ο iOS service worker
**δεν** εγγράφεται → το «Add to Home Screen» δουλεύει, αλλά χωρίς offline
cache. ΟΚ για δοκιμή στο σπίτι, όχι για το γυμναστήριο.

## Φάση 3 — Το Mac ως «server» (auto-start)

Για να μη σηκώνεις τίποτα με το χέρι:

1. **PostgreSQL**: `brew services start postgresql@16` (ήδη γίνεται).
2. **Node services**: ένα LaunchAgent (`~/Library/LaunchAgents/com.workoutpronow.plist`)
   που τρέχει το υπάρχον `pnpm local:services` στο login, ή `pm2 start … && pm2 save`.
3. **Ύπνος**: τα LaunchAgents ξυπνούν μαζί με το Mac· αν θες 24/7
   διαθεσιμότητα με κλειστό καπάκι, `caffeinate` ή Energy Saver → «Prevent
   automatic sleeping when the display is off».

## Φάση 4 — Εγκατάσταση στο iPhone (2΄)

1. Safari → άνοιξε το URL (Tailscale ή LAN).
2. Login (Continue) → ολοκλήρωσε profile/program αν είναι πρώτη φορά.
3. **Share ▸ Add to Home Screen** → εμφανίζεται ως **WorkOutProNow**
   με το εικονίδιο, fullscreen χωρίς Safari chrome.
4. Δοκίμασε: Manage → Open ημέρα → Perform → log ένα set → βάλε αεροπλάνο
   → log άλλο ένα (πάει στο offline queue) → κλείσε αεροπλάνο → συγχρονίζει.

## Φάση 5 (προαιρετική) — Native sideload αργότερα

Αν κάποια στιγμή θες native (π.χ. HealthKit, τοπικά notifications):
Capacitor πάνω στο υπάρχον `apps/client/public` (`npx cap add ios`), build
από Xcode στο συνδεδεμένο iPhone με **δωρεάν** Apple ID. Το app λήγει κάθε
7 μέρες και θέλει ξανά «Run» από το Xcode — γι' αυτό είναι Plan B, όχι Plan A.

---

## Σύνοψη εργασιών

| #   | Εργασία                                         | Χρόνος | Blocker για                      |
| --- | ----------------------------------------------- | ------ | -------------------------------- |
| 1   | PNG icons + iOS meta tags + safe-area CSS       | 30΄    | εικονίδιο/fullscreen             |
| 2   | Tailscale σε Mac+iPhone, `tailscale serve 3000` | 20΄    | πρόσβαση εκτός σπιτιού + offline |
| 3   | LaunchAgent για services + brew postgres        | 20΄    | «πάντα αναμμένο»                 |
| 4   | Add to Home Screen + δοκιμή offline sync        | 10΄    | —                                |

Συνολικά ~1,5 ώρα, κόστος **€0**, χωρίς Apple λογαριασμό developer.
