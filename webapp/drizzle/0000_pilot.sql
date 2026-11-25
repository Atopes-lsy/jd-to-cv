CREATE TABLE daily_budget (day TEXT PRIMARY KEY, units INTEGER NOT NULL DEFAULT 0 CHECK(units>=0 AND units<=20));
--> statement-breakpoint
CREATE TABLE analytics (day TEXT NOT NULL, event TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,event));
--> statement-breakpoint
CREATE TABLE feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), text TEXT NOT NULL);
