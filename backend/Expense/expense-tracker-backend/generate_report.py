import sys
import os
import json
from datetime import datetime
import math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from matplotlib.backends.backend_pdf import PdfPages
from collections import OrderedDict

# Configuration
ROWS_PER_TABLE_PAGE = 28  # roughly how many table rows fit comfortably per PDF page (adjust if needed)
MAX_DESCRIPTION_LENGTH = 120  # truncate long descriptions for table rendering

def load_json(path):
    with open(path, 'r', encoding='utf8') as f:
        return json.load(f)

def parse_date_any(s):
    if not s:
        return None
    if isinstance(s, (int, float)):
        try:
            return datetime.fromtimestamp(s)
        except:
            return None
    if isinstance(s, str):
        s = s.strip()
        # try iso
        try:
            return datetime.fromisoformat(s)
        except:
            pass
        fmts = ['%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%d-%m-%Y', '%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d']
        for fmt in fmts:
            try:
                return datetime.strptime(s, fmt)
            except:
                pass
    return None

def aggregate_monthly(expenses):
    monthly = {}
    for e in expenses:
        dt = parse_date_any(e.get('date') or e.get('createdAt'))
        if not dt:
            continue
        key = dt.strftime('%Y-%m')
        monthly.setdefault(key, 0.0)
        monthly[key] += float(e.get('totalExpense') or e.get('amount') or 0)
    return OrderedDict(sorted(monthly.items()))

def aggregate_categories(expenses):
    cats = {}
    for e in expenses:
        c = e.get('category') or 'Others'
        cats.setdefault(c, 0.0)
        cats[c] += float(e.get('totalExpense') or e.get('amount') or 0)
    return dict(sorted(cats.items(), key=lambda x: -x[1]))

def format_currency(v):
    try:
        v = float(v)
    except:
        v = 0.0
    return f"₹{v:,.2f}"

def chunk_list(lst, n):
    """Yield successive n-sized chunks from lst."""
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def safe_str(s, length=None):
    if s is None:
        return ''
    out = str(s)
    if length and len(out) > length:
        return out[:length-1] + "…"
    return out

def generate_report(user, expenses, output_path):
    try:
        sns.set_style("whitegrid")
        plt.rcParams.update({
            'figure.facecolor': '#0b0b0b',
            'axes.facecolor': '#0b0b0b',
            'text.color': 'white',
            'axes.labelcolor': 'white',
            'xtick.color': 'white',
            'ytick.color': 'white',
            'font.size': 10
        })

        # Normalize input into canonical list with parsed dates
        canonical = []
        for e in expenses:
            amount = float(e.get('totalExpense') or e.get('amount') or 0)
            raw_date = e.get('date') or e.get('createdAt') or ''
            dt = parse_date_any(raw_date)
            date_str = dt.strftime('%Y-%m-%d') if dt else (raw_date if isinstance(raw_date, str) else '')
            canonical.append({
                'date_obj': dt,
                'date': date_str,
                'description': e.get('description') or '',
                'category': e.get('category') or 'Others',
                'amount': amount,
                'totalExpense': amount
            })

        total_spent_all = sum([c['amount'] for c in canonical])
        total_transactions = len(canonical)
        dates_with_obj = [c['date_obj'] for c in canonical if c['date_obj'] is not None]
        first_date = min(dates_with_obj) if dates_with_obj else None
        last_date = max(dates_with_obj) if dates_with_obj else None

        monthly = aggregate_monthly(canonical)
        categories = aggregate_categories(canonical)

        pp = PdfPages(output_path)

        # ---------------- Cover page ----------------
        fig = plt.figure(figsize=(11, 8.5), facecolor='#0b0b0b')
        ax = fig.add_subplot(111)
        ax.axis('off')
        ax.text(0.05, 0.7, 'ExpenseAI', fontsize=48, fontweight='bold', color='white')
        ax.text(0.05, 0.6, f"Financial Report", fontsize=20, color='white')
        ax.text(0.05, 0.5, f"User: {user.get('email','N/A')}", fontsize=12, color='white')
        if first_date and last_date:
            ax.text(0.05, 0.45, f"Period covered: {first_date.strftime('%Y-%m-%d')} → {last_date.strftime('%Y-%m-%d')}", fontsize=11, color='white')
        ax.text(0.05, 0.35, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", fontsize=10, color='white')
        ax.text(0.05, 0.16, f"Transactions: {total_transactions}", fontsize=10, color='white')
        ax.text(0.05, 0.12, f"Total spent (all time): {format_currency(total_spent_all)}", fontsize=14, fontweight='bold', color='#00d9ff')
        pp.savefig(fig, bbox_inches='tight')
        plt.close(fig)

        # ---------------- Summary + charts ----------------
        fig, axes = plt.subplots(2, 2, figsize=(11, 8.5))
        fig.suptitle('Spending Summary', fontsize=18, color='white')

        # Monthly trend
        ax = axes[0, 0]
        months = list(monthly.keys())
        vals = list(monthly.values())
        if months:
            ax.plot(range(len(months)), vals, marker='o', color='#00d9ff')
            ax.set_title('Monthly Spending (all time)')
            ax.set_xticks(range(len(months)))
            if len(months) > 12:
                step = max(1, len(months) // 12)
                ax.set_xticks(range(0, len(months), step))
                ax.set_xticklabels([months[i] for i in range(0, len(months), step)], rotation=45, fontsize=8)
            else:
                ax.set_xticklabels(months, rotation=45, fontsize=8)
        else:
            ax.text(0.5, 0.5, 'No data', ha='center', va='center', color='white')

        # Category pie
        ax = axes[0, 1]
        if categories:
            labels = list(categories.keys())
            sizes = list(categories.values())
            colors = plt.cm.tab20.colors
            ax.pie(sizes, labels=labels, autopct='%1.1f%%', startangle=90, colors=colors[:len(labels)])
            ax.set_title('Spending by Category')
        else:
            ax.text(0.5, 0.5, 'No data', ha='center', va='center', color='white')

        # Yearly totals
        ax = axes[1, 0]
        if months:
            years = {}
            for k, v in monthly.items():
                yr = k.split('-')[0]
                years.setdefault(yr, 0)
                years[yr] += v
            yrs = list(years.keys())
            yvals = list(years.values())
            ax.bar(yrs, yvals, color='#00d9ff')
            ax.set_title('Yearly Total Spend')
            for i, v in enumerate(yvals):
                ax.text(i, v, f'₹{v:,.0f}', ha='center', va='bottom', color='white', fontsize=8)
        else:
            ax.text(0.5, 0.5, 'No data', ha='center', va='center', color='white')

        # Key stats
        ax = axes[1, 1]
        ax.axis('off')
        avg_month = (sum(vals) / len(vals)) if vals else 0
        max_month = max(vals) if vals else 0
        top_cat_label = list(categories.keys())[0] if categories else 'N/A'
        stats = f"""
Total spent (all time): {format_currency(total_spent_all)}
Total transactions: {total_transactions}

Average monthly spend: {format_currency(avg_month)}
Highest month: {format_currency(max_month)}
Top category: {top_cat_label}
"""
        ax.text(0.05, 0.5, stats, fontsize=11, va='center', color='white', family='monospace')
        pp.savefig(fig, bbox_inches='tight')
        plt.close(fig)

        # ---------------- All Transactions (CSV) pages - FIXED ----------------
        # Build table rows: Date | Description | Category | Amount
        if canonical:
            rows = []
            for c in canonical:
                rows.append([
                    c.get('date') or '',
                    safe_str(c.get('description') or '', MAX_DESCRIPTION_LENGTH),
                    safe_str(c.get('category') or '', 40),
                    format_currency(c.get('amount') or 0)
                ])
            # Split into pages
            pages = list(chunk_list(rows, ROWS_PER_TABLE_PAGE))
            for pidx, page_rows in enumerate(pages):
                fig = plt.figure(figsize=(11, 8.5), facecolor='#0b0b0b')
                ax = fig.add_subplot(111)
                ax.axis('off')
                ax.set_xlim(0, 1)
                ax.set_ylim(0, 1)
                
                title = 'All Transactions (CSV)'
                if len(pages) > 1:
                    title = f'All Transactions (CSV) — Page {pidx + 1} of {len(pages)}'
                
                # Add title at top
                ax.text(0.5, 0.95, title, fontsize=16, color='white', 
                       ha='center', va='top', fontweight='bold')
                
                # Create table data with header
                table_data = [['Date', 'Description', 'Category', 'Amount']] + page_rows
                
                # Create table
                table = ax.table(cellText=table_data, 
                               colWidths=[0.12, 0.56, 0.18, 0.14], 
                               colLoc='left', 
                               loc='upper center',
                               bbox=[0.05, 0.05, 0.9, 0.85])
                
                table.auto_set_font_size(False)
                table.set_fontsize(9)
                
                # Style the cells - THIS IS THE KEY FIX
                for i in range(len(table_data)):
                    for j in range(len(table_data[0])):
                        cell = table[(i, j)]
                        
                        if i == 0:  # Header row
                            cell.set_facecolor('#1a1a1a')
                            cell.set_text_props(weight='bold', color='#00d9ff', size=10)
                            cell.set_edgecolor('#333333')
                        else:  # Data rows
                            # Alternate row colors for better readability
                            if i % 2 == 0:
                                cell.set_facecolor('#1a1a1a')
                            else:
                                cell.set_facecolor('#0f0f0f')
                            cell.set_text_props(color='white', size=8)
                            cell.set_edgecolor('#222222')
                        
                        cell.set_linewidth(0.5)
                
                pp.savefig(fig, bbox_inches='tight')
                plt.close(fig)
        else:
            fig = plt.figure(figsize=(11, 8.5), facecolor='#0b0b0b')
            ax = fig.add_subplot(111)
            ax.axis('off')
            ax.text(0.5, 0.5, 'No transactions to display', ha='center', va='center', color='white', fontsize=14)
            pp.savefig(fig, bbox_inches='tight')
            plt.close(fig)

        # ---------------- Recommendations ----------------
        fig = plt.figure(figsize=(11, 8.5), facecolor='#0b0b0b')
        ax = fig.add_subplot(111)
        ax.axis('off')
        fig.suptitle('AI Recommendations', fontsize=16, color='white')
        recs = []
        if total_transactions == 0:
            recs.append('No transactions found — start tracking your expenses.')
        else:
            recs.append('Review top categories and set monthly caps.')
            if canonical:
                # simple heuristic for single large category
                cat_totals = aggregate_categories(canonical)
                top_cat = next(iter(cat_totals.keys())) if cat_totals else None
                if top_cat and cat_totals[top_cat] / max(1, total_spent_all) > 0.25:
                    recs.append(f'High spend in {top_cat}. Consider reducing it by 10-20%.')
        for i, r in enumerate(recs):
            ax.text(0.05, 0.9 - i * 0.12, f'• {r}', fontsize=12, color='white')
        pp.savefig(fig, bbox_inches='tight')
        plt.close(fig)

        pp.close()
        print(json.dumps({"success": True, "path": output_path}))
        return 0

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return 1

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({"error": "missing args"}))
        sys.exit(1)
    _, user_path, exp_path, out_path = sys.argv
    try:
        user = load_json(user_path)
        expenses = load_json(exp_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to load input JSON: {e}"}))
        sys.exit(1)
    rc = generate_report(user, expenses, out_path)
    sys.exit(rc)