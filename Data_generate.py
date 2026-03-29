from __future__ import annotations
import argparse
import json
import math
import os
import random
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
import calendar
from multiprocessing import Pool

import numpy as np
import pandas as pd

# -------------------------
# Behaviors (same as original, easily tweakable)
# -------------------------
BEHAVIORS = {
    "disciplined_saver": {
        "budget_mean": 700, "budget_std": 80, "weekend_multiplier": 1.05,
        "category_weights": {"bills": 0.35, "food": 0.2, "shopping": 0.1, "entertainment": 0.05, "other": 0.3},
        "big_spend_prob": 0.01, "salary_on_start": True
    },
    "foodie": {
        "budget_mean": 1000, "budget_std": 150, "weekend_multiplier": 1.6,
        "category_weights": {"bills": 0.2, "food": 0.45, "shopping": 0.15, "entertainment": 0.1, "other": 0.1},
        "big_spend_prob": 0.03, "salary_on_start": True
    },
    "party_person": {
        "budget_mean": 1200, "budget_std": 200, "weekend_multiplier": 2.2,
        "category_weights": {"bills": 0.15, "food": 0.25, "shopping": 0.1, "entertainment": 0.35, "other": 0.15},
        "big_spend_prob": 0.05, "salary_on_start": True
    },
    "online_shopper": {
        "budget_mean": 1100, "budget_std": 180, "weekend_multiplier": 1.1,
        "category_weights": {"bills": 0.2, "food": 0.15, "shopping": 0.45, "entertainment": 0.1, "other": 0.1},
        "big_spend_prob": 0.08, "salary_on_start": True
    },
    "random_spender": {
        "budget_mean": 950, "budget_std": 300, "weekend_multiplier": 1.2,
        "category_weights": {"bills": 0.2, "food": 0.25, "shopping": 0.2, "entertainment": 0.15, "other": 0.2},
        "big_spend_prob": 0.07, "salary_on_start": False
    },
    "traveler": {
        "budget_mean": 1300, "budget_std": 250, "weekend_multiplier": 1.3,
        "category_weights": {"bills": 0.15, "food": 0.2, "shopping": 0.1, "entertainment": 0.15, "other": 0.4},
        "big_spend_prob": 0.12, "salary_on_start": True
    },
    "freelancer_irregular_income": {
        "budget_mean": 900, "budget_std": 280, "weekend_multiplier": 1.0,
        "category_weights": {"bills": 0.25, "food": 0.2, "shopping": 0.12, "entertainment": 0.08, "other": 0.35},
        "big_spend_prob": 0.04, "salary_on_start": False, "irregular_income": True
    },
    "family_with_kids": {
        "budget_mean": 1500, "budget_std": 250, "weekend_multiplier": 1.35,
        "category_weights": {"bills": 0.4, "food": 0.25, "shopping": 0.15, "entertainment": 0.05, "other": 0.15},
        "big_spend_prob": 0.03, "salary_on_start": True
    },
    "bargain_hunter": {
        "budget_mean": 850, "budget_std": 120, "weekend_multiplier": 1.0,
        "category_weights": {"bills": 0.3, "food": 0.2, "shopping": 0.35, "entertainment": 0.05, "other": 0.1},
        "big_spend_prob": 0.02, "salary_on_start": True, "waits_for_sales": True
    },
    "luxury_spender": {
        "budget_mean": 2000, "budget_std": 400, "weekend_multiplier": 1.4,
        "category_weights": {"bills": 0.2, "food": 0.15, "shopping": 0.45, "entertainment": 0.1, "other": 0.1},
        "big_spend_prob": 0.1, "salary_on_start": True
    }
}

CATEGORIES = ["bills", "food", "shopping", "entertainment", "other"]

MERCHANTS = {
    "food": ["Cafe Aroma", "Burger Hub", "Sushi World", "Pizza Palace", "Green Eatery"],
    "shopping": ["ShopEasy", "Mall Central", "ElectroGoods", "Fashion Lane", "Book Nook"],
    "bills": ["Electric Co", "Waterworks", "InternetPro", "PhoneCorp", "Rent LLC"],
    "entertainment": ["CinemaX", "ConcertHub", "ArcadeZone", "Theatre Royale", "StreamingPlus"],
    "other": ["PharmacyPlus", "Transit", "PetCare", "Gifts & Co", "Misc Services"]
}

# small set of plausible geo-clusters (lat, lon) centered in India cities for realism
GEO_CLUSTERS = {
    "delhi": (28.67, 77.23),
    "mumbai": (19.07, 72.87),
    "bangalore": (12.97, 77.59),
    "kolkata": (22.57, 88.36),
    "chennai": (13.08, 80.27)
}

# -------------------------
# Utilities
# -------------------------
def clamp(v: float, lo: float = 0.0, hi: float | None = None) -> float:
    try:
        vv = float(v)
    except Exception:
        vv = 0.0
    lo_val = float(lo) if lo is not None else float("-inf")
    if hi is None:
        return max(lo_val, vv)
    try:
        hi_val = float(hi)
    except Exception:
        hi_val = float("inf")
    return max(lo_val, min(hi_val, vv))


def add_months(dt: datetime, months: int) -> datetime:
    year = dt.year + (dt.month - 1 + months) // 12
    month = (dt.month - 1 + months) % 12 + 1
    day = dt.day
    last_day = calendar.monthrange(year, month)[1]
    day = min(day, last_day)
    return datetime(year, month, day)


def day_is_month_start(dt: datetime) -> bool:
    # keep the original heuristic but could be tightened
    return dt.day <= 5


def day_is_month_end(dt: datetime) -> bool:
    return dt.day >= 28


def sample_category_breakdown(weights: dict, total: float) -> dict:
    # keep the base approach but reduce extreme noise for stability
    base = np.array([weights.get(cat, 0.0) for cat in CATEGORIES], dtype=float)
    # add small gamma noise, but less aggressive
    noise = np.random.gamma(shape=2.0, scale=0.3, size=base.size)
    alpha = base + noise * 0.08
    if alpha.sum() <= 0:
        alpha = np.ones_like(alpha)
    proportions = np.random.dirichlet(alpha + 1e-6)
    # ensure minimum for bills
    proportions[CATEGORIES.index("bills")] = max(proportions[CATEGORIES.index("bills")], 0.05)
    proportions = proportions / proportions.sum()
    amounts = (proportions * total).round(2)
    diff = round(total - amounts.sum(), 2)
    amounts[0] += diff
    return dict(zip(CATEGORIES, amounts.tolist()))


def generate_transactions_for_day(date: datetime, breakdown: dict, merchants: dict, user_id: str, geo: tuple) -> list:
    txs = []
    for cat, amt in breakdown.items():
        if amt <= 0:
            continue
        # bills typically single transaction
        avg_tx = 1 if cat == "bills" else max(1, int(min(6, max(1, amt // 50))))
        n_tx = max(1, np.random.poisson(lam=max(1, avg_tx)))
        # avoid exploding number of txs
        n_tx = min(n_tx, 8)
        parts = np.random.dirichlet(np.ones(n_tx)) * amt
        parts = np.round(parts, 2)
        diff = round(amt - parts.sum(), 2)
        parts[0] += diff
        for p in parts:
            # timestamp: random minute within the day (8:00 - 22:00)
            minute = random.randint(8 * 60, 22 * 60)
            timestamp = (date + timedelta(minutes=minute)).isoformat()
            # small jitter to geo
            lat = geo[0] + np.random.normal(scale=0.01)
            lon = geo[1] + np.random.normal(scale=0.01)
            tx = {
                "transaction_id": str(uuid.uuid4()),
                "user_id": user_id,
                "date": date.strftime("%Y-%m-%d"),
                "timestamp": timestamp,
                "merchant": random.choice(merchants.get(cat, ["Generic Merchant"])),
                "category": cat,
                "amount": float(p),
                "currency": "INR",
                "lat": round(float(lat), 5),
                "lon": round(float(lon), 5),
                "description": f"{cat} purchase"
            }
            txs.append(tx)
    random.shuffle(txs)
    return txs


def _make_holiday_set(years: list[int], rng_seed: int = 0) -> set:
    """
    Synthetic, non-exhaustive holiday generator.
    We add a few fixed-date items (Jan 1, May 1, Aug 15, Oct 2, Dec 25)
    plus a couple of per-year random festival-like days (to simulate Diwali/Holi etc).
    This keeps the data realistic without needing an external holiday calendar.
    """
    rand = random.Random(rng_seed)
    holidays = set()
    for y in years:
        holidays.add(datetime(y, 1, 1).date())   # New Year
        holidays.add(datetime(y, 5, 1).date())   # Labour / May Day
        holidays.add(datetime(y, 8, 15).date())  # Independence-day like
        holidays.add(datetime(y, 10, 2).date())  # Gandhi-like
        holidays.add(datetime(y, 12, 25).date()) # Xmas-like
        # add two random festival days per year
        for _ in range(2):
            m = rand.randint(1, 12)
            d = rand.randint(1, calendar.monthrange(y, m)[1])
            holidays.add(datetime(y, m, d).date())
    return holidays


# Per-user daily generator (calendar-accurate), improved

def generate_person_daily(user_id: str,
                          behavior: str,
                          start_date: datetime,
                          months: int,
                          include_transactions: bool = False,
                          seed_offset: int = 0,
                          missing_day_prob: float = 0.005,
                          holiday_seed: int = 0,
                          files_variant_index: int = 0):
   
    # Deterministic per-user randomness
    seed = (hash(user_id) & 0xffffffff) ^ (seed_offset + files_variant_index)
    random.seed(seed)
    np.random.seed(seed % (2**32 - 1))

    cfg = BEHAVIORS[behavior]
    # monthly income estimation (not required but useful)
    monthly_income = max(500.0, float(np.random.normal(cfg["budget_mean"] * 30, cfg["budget_std"] * 30)))
    daily_budget = max(50.0, float(np.random.normal(cfg["budget_mean"], cfg["budget_std"])))
    salary_day = random.randint(1, 5) if cfg.get("salary_on_start", False) else None

    end_date = add_months(start_date, months)
    last_inclusive = end_date - timedelta(days=1)
    days_total = (last_inclusive - start_date).days + 1
    if days_total <= 0:
        if include_transactions:
            return pd.DataFrame([]), pd.DataFrame([]), {}
        return pd.DataFrame([]), None, {}

    # pick user's geo cluster
    geo_key = random.choice(list(GEO_CLUSTERS.keys()))
    geo_center = GEO_CLUSTERS[geo_key]

    # construct holiday set for covered years
    years = list(range(start_date.year, (last_inclusive.year) + 1))
    holidays = _make_holiday_set(years, rng_seed=holiday_seed + seed % 997)

    rows = []
    txs_all = []
    expense_history = []
    balance = float(np.random.normal(1000.0, 500.0))  # initial wallet balance

    # small seasonal multiplier by month to create monthly variation
    month_seasonality = {m: 1.0 + 0.08 * math.sin((m / 12.0) * 2 * math.pi) for m in range(1, 13)}

    for i in range(days_total):
        date = start_date + timedelta(days=i)
        dow = date.weekday()
        is_weekend = 1 if dow >= 5 else 0
        is_month_start = 1 if day_is_month_start(date) else 0
        is_month_end = 1 if day_is_month_end(date) else 0

        # chance to drop a row (simulate missing data / offline days) - small
        if random.random() < missing_day_prob:
            # optionally still generate transactions but mark as missing later; here we skip row entirely
            # skip to next day
            continue

        base = float(np.random.normal(daily_budget, daily_budget * 0.12))
        base *= (cfg.get("weekend_multiplier", 1.0) if is_weekend else 1.0)
        # seasonality
        base *= month_seasonality.get(date.month, 1.0)

        # holidays and vacation days cause spikes or dips
        if date.date() in holidays:
            # sometimes more spend (festival), sometimes less (holiday at home)
            if random.random() < 0.6:
                base *= 1.5 + np.random.rand() * 1.5
            else:
                base *= 0.6 + np.random.rand() * 0.6

        # salary or income events
        income = 0.0
        if salary_day and date.day == salary_day:
            income = monthly_income * (0.9 + np.random.rand() * 0.4)  # salary/inflow
            base *= 1.05 + np.random.rand() * 1.2

        if cfg.get("irregular_income", False) and random.random() < 0.06:
            # freelancer occasional big inflow
            income = monthly_income * (0.4 + np.random.rand() * 2.4)
            base *= 1.2 + np.random.rand() * 1.5

        # occasional big spend events
        if random.random() < cfg.get("big_spend_prob", 0.03):
            base *= 2.5 + np.random.rand() * 4.0

        # sales/bargains heuristic
        if cfg.get("waits_for_sales", False) and is_month_start and is_weekend:
            base *= 1.6

        actual_expense = clamp(round(base, 2), 0.0, None)
        breakdown = sample_category_breakdown(cfg["category_weights"], actual_expense)

        if len(expense_history) == 0:
            prev_day = actual_expense
            prev_week_avg = actual_expense
            prev_month_avg = actual_expense
            food_last_7d = breakdown.get("food", 0.0)
            shopping_last_7d = breakdown.get("shopping", 0.0)
        else:
            prev_day = expense_history[-1]["actual_expense"]
            window7 = expense_history[-7:] if len(expense_history) >= 7 else expense_history
            window30 = expense_history[-30:] if len(expense_history) >= 30 else expense_history
            prev_week_avg = float(np.mean([x["actual_expense"] for x in window7]))
            prev_month_avg = float(np.mean([x["actual_expense"] for x in window30]))
            food_last_7d = sum([x["food_expense"] for x in window7])
            shopping_last_7d = sum([x["shopping_expense"] for x in window7])

        # update balance with income, then subtract expenses
        balance = float(round(balance + income - actual_expense, 2))

        row = {
            "date": date.strftime("%Y-%m-%d"),
            "day_of_week": dow,
            "is_weekend": is_weekend,
            "is_month_start": is_month_start,
            "is_month_end": is_month_end,
            "prev_day_expense": round(prev_day, 2),
            "prev_week_avg": round(prev_week_avg, 2),
            "prev_month_avg": round(prev_month_avg, 2),
            "food_last_7d": round(food_last_7d, 2),
            "shopping_last_7d": round(shopping_last_7d, 2),
            "daily_budget": round(daily_budget, 2),
            "food_expense": float(breakdown["food"]),
            "shopping_expense": float(breakdown["shopping"]),
            "bills_expense": float(breakdown["bills"]),
            "entertainment_expense": float(breakdown["entertainment"]),
            "other_expense": float(breakdown["other"]),
            "income": float(round(income, 2)),
            "balance": balance,
            "actual_expense": float(round(actual_expense, 2)),
            "geo_center": geo_key
        }

        expense_history.append(row)
        rows.append(row)

        if include_transactions:
            txs = generate_transactions_for_day(date, breakdown, MERCHANTS, user_id, geo_center)
            txs_all.extend(txs)

    df_daily = pd.DataFrame(rows)
    df_txs = pd.DataFrame(txs_all) if include_transactions else None

    # small realistic touch: introduce occasional NaNs in non-target columns (simulate noisy data)
    if not df_daily.empty and np.random.rand() < 0.02:
        col = random.choice(["food_last_7d", "shopping_last_7d", "prev_week_avg"])
        df_daily.loc[df_daily.sample(frac=0.02, random_state=seed).index, col] = np.nan

    # metadata
    metadata = {
        "user_id": user_id,
        "behavior": behavior,
        "start_date": start_date.strftime("%Y-%m-%d"),
        "months": months,
        "rows_daily": int(len(df_daily)),
        "geo_center": geo_key,
        "files_variant_index": files_variant_index
    }
    return df_daily, df_txs, metadata

# Worker wrapper for multiprocessing

def worker_task(args_tuple):
    """
    args_tuple:
      (uid, behavior, start, months, include_transactions, out_dir, tx_dir, compress,
       files_variant_index, global_seed, missing_day_prob, holiday_seed)
    """
    (uid, behavior, start, months, include_transactions, out_dir, tx_dir, compress,
     files_variant_index, global_seed, missing_day_prob, holiday_seed) = args_tuple

    df_daily, df_txs, meta = generate_person_daily(
        uid, behavior, start, months,
        include_transactions=include_transactions,
        seed_offset=global_seed,
        missing_day_prob=missing_day_prob,
        holiday_seed=holiday_seed,
        files_variant_index=files_variant_index
    )

    filename_base = f"{uid}_{behavior}"
    if files_variant_index > 0:
        filename_base = f"{filename_base}_v{files_variant_index}"
    filename = os.path.join(out_dir, f"{filename_base}.csv")
    if compress:
        filename = filename + ".gz"

    # write CSVs; catch exceptions per-file but return metadata about failure if any
    try:
        if compress:
            df_daily.to_csv(filename, index=False, compression="gzip")
        else:
            df_daily.to_csv(filename, index=False)
    except Exception as e:
        meta["error"] = f"write_daily_failed: {e}"
        meta["daily_csv"] = None
        meta["transactions_csv"] = None
        return meta

    tx_file_path = None
    if include_transactions and df_txs is not None and not df_txs.empty:
        tx_file_path = os.path.join(tx_dir, f"{filename_base}_transactions.csv")
        if compress:
            tx_file_path = tx_file_path + ".gz"
        try:
            if compress:
                df_txs.to_csv(tx_file_path, index=False, compression="gzip")
            else:
                df_txs.to_csv(tx_file_path, index=False)
        except Exception as e:
            meta["error"] = f"write_txs_failed: {e}"
            meta["daily_csv"] = os.path.abspath(filename)
            meta["transactions_csv"] = None
            return meta

    meta["daily_csv"] = os.path.abspath(filename)
    meta["transactions_csv"] = os.path.abspath(tx_file_path) if tx_file_path else None
    return meta

# -------------------------
# CLI main
# -------------------------
def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate improved synthetic expense CSVs for model training")
    parser.add_argument("--output-dir", type=str, default="training_data", help="Directory to write CSVs")
    parser.add_argument("--users-per-behavior", type=int, default=1000, help="Users per behavior (max safety cap)")
    parser.add_argument("--files-per-user", type=int, default=1, help="Number of CSV variants to emit per logical user (use with caution)")
    parser.add_argument("--min-months", type=int, default=6, help="Minimum months of history per user")
    parser.add_argument("--max-months", type=int, default=12, help="Maximum months of history per user")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--start-year", type=int, default=2024, help="Earliest start year for data")
    parser.add_argument("--year-span", type=int, default=1, help="Span of years for start date randomization (0 = only start-year)")
    parser.add_argument("--include-transactions", action="store_true", help="Produce transaction CSVs (large output)")
    # compress default True to protect disk usage for large run
    parser.add_argument("--compress", action="store_true", default=True, help="Compress CSVs as .csv.gz (default: True)")
    parser.add_argument("--force", action="store_true", help="Force generation without safety prompt")
    parser.add_argument("--preview", action="store_true", help="Preview one user per behavior and exit (no writes)")
    parser.add_argument("--max-per-behavior-allowed", type=int, default=1000, help="Absolute safety cap")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 1)//2), help="Parallel worker processes (set >1 for multiprocessing)")
    parser.add_argument("--missing-day-prob", type=float, default=0.005, help="Probability a day is missing from daily file (simulate noise)")
    parser.add_argument("--files-split", choices=["none", "trainvaltest"], default="none", help="Optionally partition files into train/val/test layout")
    args = parser.parse_args(argv)

    # basic validation
    if args.users_per_behavior < 1:
        print("Error: users-per-behavior must be >= 1", file=sys.stderr)
        sys.exit(1)
    if args.users_per_behavior > args.max_per_behavior_allowed:
        print(f"Error: users-per-behavior must be <= {args.max_per_behavior_allowed} (safety limit)", file=sys.stderr)
        sys.exit(1)
    if args.files_per_user < 1:
        print("Error: files-per-user must be >= 1", file=sys.stderr)
        sys.exit(1)
    if args.files_per_user * args.users_per_behavior * len(BEHAVIORS) > 20000 and not args.force:
        # a more aggressive safety guard for explosion across files-per-user as well
        print("Warning: requested a very large number of files. Re-run with --force to proceed.", file=sys.stderr)
        sys.exit(1)

    random.seed(args.seed)
    np.random.seed(args.seed)

    out_dir = args.output_dir
    tx_dir = os.path.join(out_dir, "transactions")
    os.makedirs(out_dir, exist_ok=True)
    if args.include_transactions:
        os.makedirs(tx_dir, exist_ok=True)

    behaviors = list(BEHAVIORS.keys())
    total_logical_users = len(behaviors) * args.users_per_behavior
    total_files = total_logical_users * args.files_per_user
    print(f"Planned generation: {len(behaviors)} behaviors x {args.users_per_behavior} users x {args.files_per_user} files-per-user = {total_files} files")
    print(f"Output directory: {os.path.abspath(out_dir)}")
    if args.compress:
        print("CSV files will be compressed (.csv.gz)")
    if args.include_transactions:
        print("Transaction-level CSVs will be produced (can greatly increase disk usage)")

    # Safety for very large runs
    if total_files > 30000 and not args.force and not args.preview:
        print(f"Warning: You are about to generate {total_files} files. This may consume significant disk space and time.")
        print("Rerun with --force to proceed or use smaller --users-per-behavior/--files-per-user.")
        sys.exit(1)

    if args.preview:
        print("Preview mode: generating one example per behavior (no files written)")

    metadata = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "behaviors": behaviors,
        "users_per_behavior": args.users_per_behavior,
        "files_per_user": args.files_per_user,
        "files": []
    }

    # Build tasks
    tasks = []
    user_counter = 1
    for behavior in behaviors:
        for i in range(args.users_per_behavior):
            # determine number of months, start date
            months = random.randint(args.min_months, args.max_months)
            year = args.start_year + random.randint(0, max(0, args.year_span))
            month = random.randint(1, 12)
            day = random.randint(1, calendar.monthrange(year, month)[1])
            user_start = datetime(year, month, day)
            uid = f"user_{user_counter:06d}"
            for v in range(args.files_per_user):
                tasks.append((uid, behavior, user_start, months, args.include_transactions,
                              out_dir, tx_dir, args.compress, v, args.seed, args.missing_day_prob, args.seed + 7))
            user_counter += 1

    t0 = time.time()

    if args.preview:
        # Just run first N previews (one per behavior ideally)
        printed = 0
        seen_behaviors = set()
        for task in tasks:
            uid, behavior, start, months, include_transactions, _, _, _, v, _, _, _ = task
            if behavior in seen_behaviors:
                continue
            df_daily, df_txs, meta = generate_person_daily(uid, behavior, start, months, include_transactions=include_transactions, seed_offset=args.seed, files_variant_index=v)
            print(f"\n=== Preview for {uid} ({behavior}) months={months} start={start.date()} rows={len(df_daily)} variant={v} ===")
            print(df_daily.head(7).to_string(index=False))
            seen_behaviors.add(behavior)
            printed += 1
            if printed >= len(behaviors):
                break
        print("\nPreview complete. No files written.")
        return

    # Run tasks either sequentially or with multiprocessing
    results = []
    if args.workers <= 1:
        for idx, t in enumerate(tasks, start=1):
            meta = worker_task(t)
            results.append(meta)
            if idx % 100 == 0:
                elapsed = time.time() - t0
                print(f"  Generated {idx}/{len(tasks)} files (elapsed {elapsed:.1f}s)")
    else:
        # multiprocessing Pool
        pool_size = max(1, min(args.workers, os.cpu_count() or 1))
        print(f"Using multiprocessing with {pool_size} workers")
        with Pool(pool_size) as p:
            for i, meta in enumerate(p.imap_unordered(worker_task, tasks), start=1):
                results.append(meta)
                if i % 200 == 0:
                    elapsed = time.time() - t0
                    print(f"  Generated {i}/{len(tasks)} files (elapsed {elapsed:.1f}s)")

    # Optionally split into train/val/test by simple hashing (if requested)
    if args.files_split == "trainvaltest":
        for r in results:
            uid = r.get("user_id", "")
            h = hash(uid) % 100
            if h < 80:
                r["split"] = "train"
            elif h < 90:
                r["split"] = "val"
            else:
                r["split"] = "test"

    metadata["files"] = results

    # write metadata
    meta_path = os.path.join(out_dir, "metadata.json")
    with open(meta_path, "w", encoding="utf-8") as mf:
        json.dump(metadata, mf, indent=2)

    elapsed = time.time() - t0
    print(f"\nDone. Generated {len(results)} files in {elapsed:.1f}s")
    print(f"Metadata written to: {meta_path}")
    if len(results) > 0:
        sample = results[:3]
        print("Sample files:")
        for s in sample:
            print(" ", s.get("daily_csv"))


if __name__ == "__main__":
    main()
