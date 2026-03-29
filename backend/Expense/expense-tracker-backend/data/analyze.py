#!/usr/bin/env python3
"""
analyze_cli.py

Reads a user CSV (backend/data/<userId>_expenses.csv), builds features per preprocessing.py,
and calls predictive_expenses to produce predictions. Outputs JSON on stdout and saves a
copy to backend/data/<userId>_analysis.json.

Usage example (called by server.js spawn):
python backend/data/analyze_cli.py --csv backend/data/user_123_expenses.csv --userId user_123 --monthlyIncome 50000 --targetSavings 10000 --dailyBudget 500
"""
import argparse
import json
import os
import sys
from datetime import datetime
import traceback

# Ensure local data/ directory (script dir) is on sys.path so we can import predictive_expenses, preprocessing, etc.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import numpy as np
import pandas as pd

# Now import predictive_expenses (this will load model/scaler at import time)
try:
    import predictive_expenses as pe
except Exception as e:
    # If import fails, we still want to output a JSON error
    err = {'error': 'import_failed', 'message': str(e), 'trace': traceback.format_exc()}
    print(json.dumps(err))
    sys.exit(1)

# Feature/sequence config (keep aligned with your preprocessing.py)
BEHAVIOR_TYPES = [
    "disciplined_saver","foody_person","gaming_person",
    "gym_enthusiast","online_shopper","travel_lover","weekend_party_person"
]

FEATURE_COLUMNS = [
    'day_of_week','is_weekend','salary','target_savings','daily_budget',
    'food_dining','groceries','transportation','rent','utilities',
    'parties_social','cigarettes_alcohol','entertainment','shopping',
    'online_shopping','coffee_snacks','gaming_apps','gym_fitness',
    'healthcare','travel','personal_care','total_daily_expense'
]

SEQUENCE_LENGTH = 30

def read_user_csv(csv_path):
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV not found: {csv_path}")
    df = pd.read_csv(csv_path)
    return df

def build_feature_df_from_expense_csv(df_raw, monthlyIncome=0, targetSavings=0, dailyBudget=0):
    """
    df_raw expected columns: ['userId','date','description','category','amount','totalExpense']
    Aggregate by date and map categories -> feature columns defined above.
    Returns a DataFrame with FEATURE_COLUMNS (rows ordered oldest->newest).
    """
    if df_raw is None or df_raw.shape[0] == 0:
        return pd.DataFrame(columns=FEATURE_COLUMNS)

    df = df_raw.copy()
    # Normalize and parse date
    if 'date' not in df.columns:
        df['date'] = pd.Timestamp.utcnow().date().isoformat()
    df['date'] = pd.to_datetime(df['date'], errors='coerce').dt.date
    df['amount'] = pd.to_numeric(df.get('amount') or df.get('totalExpense') or 0, errors='coerce').fillna(0.0)

    # category mapping heuristics
    def map_category(cat):
        if not isinstance(cat, str):
            return None
        lc = cat.lower()
        if 'food' in lc or 'dine' in lc: return 'food_dining'
        if 'groc' in lc: return 'groceries'
        if 'transport' in lc or 'uber' in lc or 'bus' in lc: return 'transportation'
        if 'rent' in lc: return 'rent'
        if 'util' in lc or 'electric' in lc or 'water' in lc: return 'utilities'
        if 'party' in lc or 'bar' in lc: return 'parties_social'
        if 'cig' in lc or 'alcohol' in lc: return 'cigarettes_alcohol'
        if 'entertain' in lc: return 'entertainment'
        if 'online' in lc: return 'online_shopping'
        if 'coffee' in lc or 'snack' in lc: return 'coffee_snacks'
        if 'game' in lc: return 'gaming_apps'
        if 'gym' in lc or 'fitness' in lc: return 'gym_fitness'
        if 'health' in lc or 'doctor' in lc: return 'healthcare'
        if 'travel' in lc or 'flight' in lc: return 'travel'
        if 'shop' in lc: return 'shopping'
        if 'personal' in lc or 'care' in lc: return 'personal_care'
        return None

    dates = sorted(df['date'].dropna().unique())
    if len(dates) == 0:
        return pd.DataFrame(columns=FEATURE_COLUMNS)

    rows = []
    for d in dates:
        day_rows = df[df['date'] == d]
        row = {col: 0.0 for col in FEATURE_COLUMNS}
        dow = d.weekday()  # 0 .. 6
        row['day_of_week'] = float(dow)
        row['is_weekend'] = 1.0 if dow >= 5 else 0.0
        row['salary'] = float(monthlyIncome)
        row['target_savings'] = float(targetSavings)
        row['daily_budget'] = float(dailyBudget)
        total_daily = 0.0
        for _, ex in day_rows.iterrows():
            amt = float(ex.get('amount') or ex.get('totalExpense') or 0.0)
            total_daily += amt
            cat = ex.get('category') or ''
            mapped = map_category(cat)
            if mapped and mapped in FEATURE_COLUMNS:
                row[mapped] = row.get(mapped, 0.0) + amt
        row['total_daily_expense'] = float(total_daily)
        rows.append({'date': d, **row})

    feat_df = pd.DataFrame(rows)
    feat_df = feat_df.sort_values(by='date')
    # keep only FEATURE_COLUMNS (drop the date column later)
    feat_df = feat_df[['date'] + FEATURE_COLUMNS]
    feat_df_no_date = feat_df[FEATURE_COLUMNS].copy()
    return feat_df_no_date

def main():
    parser = argparse.ArgumentParser(description="Analyze user expense CSV using predictive_expenses model")
    parser.add_argument('--csv', required=True, help='Path to user CSV (data/<userId>_expenses.csv)')
    parser.add_argument('--userId', required=False, default=None)
    parser.add_argument('--monthlyIncome', required=False, default=0, type=float)
    parser.add_argument('--targetSavings', required=False, default=0, type=float)
    parser.add_argument('--dailyBudget', required=False, default=0, type=float)
    args = parser.parse_args()

    csv_path = args.csv
    user_id = args.userId
    monthlyIncome = float(args.monthlyIncome or 0)
    targetSavings = float(args.targetSavings or 0)
    dailyBudget = float(args.dailyBudget or 0)

    try:
        df_raw = read_user_csv(csv_path)
        feat_df = build_feature_df_from_expense_csv(df_raw, monthlyIncome=monthlyIncome, targetSavings=targetSavings, dailyBudget=dailyBudget)
        if feat_df.shape[0] < SEQUENCE_LENGTH:
            out = {'error': 'not_enough_rows', 'message': f'Need at least {SEQUENCE_LENGTH} days of data, found {feat_df.shape[0]}'}
            # write analysis file if userId provided
            if user_id:
                try:
                    out_path = os.path.join(os.path.dirname(csv_path), f"{user_id}_analysis.json")
                    with open(out_path, 'w') as fh:
                        json.dump(out, fh)
                except Exception:
                    pass
            print(json.dumps(out))
            return 0

        predict_df = feat_df.tail(SEQUENCE_LENGTH).reset_index(drop=True)

        # Call predictive_expenses.predict_behavior (wrap exceptions)
        try:
            res = pe.predict_behavior(predict_df)
            if res is None:
                result_obj = {'error': 'prediction_failed', 'message': 'Model returned no result'}
            else:
                behavior, confidence, top3, recs = res
                result_obj = {
                    'behavior': behavior,
                    'confidence': confidence,
                    'top3': top3,
                    'recommendations': recs,
                    'analyzedAt': datetime.utcnow().isoformat()
                }
        except Exception as e:
            result_obj = {'error': 'model_error', 'message': str(e), 'trace': traceback.format_exc()}

        # add a simple spending summary
        try:
            if 'total_daily_expense' in predict_df.columns:
                total_spent = float(predict_df['total_daily_expense'].sum())
                avg_daily = float(predict_df['total_daily_expense'].mean())
            else:
                total_spent = float(predict_df.sum(axis=1).sum())
                avg_daily = float(predict_df.mean(axis=1).mean())
            result_obj.setdefault('spending_analysis', {})
            result_obj['spending_analysis'].update({'total_spent': total_spent, 'avg_daily_expense': avg_daily})
        except Exception:
            pass

        # save analysis to file next to CSV if userId provided
        if user_id:
            try:
                out_path = os.path.join(os.path.dirname(csv_path), f"{user_id}_analysis.json")
                with open(out_path, 'w') as fh:
                    json.dump(result_obj, fh)
            except Exception:
                # do not fail the whole run if write fails
                pass

        print(json.dumps(result_obj))
        return 0

    except Exception as e:
        err = {'error': 'exception', 'message': str(e), 'trace': traceback.format_exc()}
        print(json.dumps(err))
        return 1

if __name__ == '__main__':
    import argparse
    sys.exit(main())