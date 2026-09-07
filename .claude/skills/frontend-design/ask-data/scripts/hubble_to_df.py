"""
hubble_to_df.py — Convert Hubble query results to a pandas DataFrame.

Usage (in execute() sandbox):
    # After running run_hubble_query():
    result = run_hubble_query(query=sql)  # called via agent tool

    # Then in execute():
    exec(open('skills/namespace/data/ask-data/scripts/hubble_to_df.py').read())
    df = hubble_to_df(result['results'])
    df.to_csv('workspace/my_data.csv', index=False)

Or load from a saved JSON file:
    df = hubble_to_df_from_file('workspace/results.json')
"""

import pandas as pd
import numpy as np
import json
import os
import sys
from datetime import datetime


def hubble_to_df(results: list, auto_cast: bool = True) -> pd.DataFrame:
    """
    Convert Hubble query results (list of dicts) to a typed pandas DataFrame.

    Args:
        results: List of row dicts from run_hubble_query()['results']
        auto_cast: If True, automatically infer and cast column types

    Returns:
        pandas DataFrame with appropriate types
    """
    if not results:
        print("Warning: Empty results list")
        return pd.DataFrame()

    df = pd.DataFrame(results)

    if auto_cast:
        df = _auto_cast_types(df)

    _print_summary(df)
    return df


def _auto_cast_types(df: pd.DataFrame) -> pd.DataFrame:
    """Infer and cast column types intelligently."""
    for col in df.columns:
        if df[col].dtype != object:
            continue  # Already typed

        col_lower = col.lower()
        sample = df[col].dropna()

        if len(sample) == 0:
            continue

        # Try numeric first
        try:
            numeric = pd.to_numeric(df[col], errors='raise')
            # Use int if no decimals, float otherwise
            if numeric.dropna().apply(lambda x: x == int(x)).all():
                df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
            else:
                df[col] = pd.to_numeric(df[col], errors='coerce')
            continue
        except (ValueError, TypeError):
            pass

        # Try datetime for date-like column names
        date_hints = ['date', 'day', 'week', 'month', 'year', 'time', 'at', 'created', 'updated', 'ds']
        if any(hint in col_lower for hint in date_hints):
            try:
                df[col] = pd.to_datetime(df[col], errors='coerce')
                if df[col].notna().any():
                    continue
                else:
                    df[col] = df[col].astype(str)  # revert if all NaT
            except (ValueError, TypeError):
                pass

        # Try boolean
        bool_vals = {'true', 'false', '1', '0', 'yes', 'no'}
        if set(sample.str.lower().unique()).issubset(bool_vals):
            df[col] = sample.str.lower().map({'true': True, 'false': False, '1': True, '0': False, 'yes': True, 'no': False})

    return df


def _print_summary(df: pd.DataFrame):
    """Print a concise summary of the DataFrame."""
    print(f"\n{'='*50}")
    print(f"DataFrame: {len(df):,} rows × {len(df.columns)} columns")
    print(f"{'='*50}")

    # Column types
    print("\nColumns:")
    for col in df.columns:
        null_pct = df[col].isna().mean() * 100
        dtype = str(df[col].dtype)
        null_str = f" ({null_pct:.0f}% null)" if null_pct > 0 else ""
        print(f"  {col:<35} {dtype:<15}{null_str}")

    # Numeric summary
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if numeric_cols:
        print("\nNumeric summary:")
        summary = df[numeric_cols].describe().round(2)
        print(summary.to_string())

    # Date range for datetime columns
    date_cols = df.select_dtypes(include=['datetime64']).columns.tolist()
    if date_cols:
        print("\nDate ranges:")
        for col in date_cols:
            print(f"  {col}: {df[col].min()} → {df[col].max()}")

    print()


def hubble_to_df_from_file(filepath: str, auto_cast: bool = True) -> pd.DataFrame:
    """Load Hubble results from a saved JSON file."""
    with open(filepath, 'r') as f:
        data = json.load(f)

    # Handle both raw list and {'results': [...]} format
    if isinstance(data, list):
        results = data
    elif isinstance(data, dict) and 'results' in data:
        results = data['results']
    else:
        raise ValueError(f"Unexpected JSON format in {filepath}")

    return hubble_to_df(results, auto_cast=auto_cast)


def save_results_json(results: list, filepath: str):
    """Save raw Hubble results to JSON for later reuse."""
    os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else '.', exist_ok=True)
    with open(filepath, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"Saved {len(results)} rows to {filepath}")


def fmt_usd(n, decimals: int = 1) -> str:
    """Format a number as USD with K/M/B suffix."""
    if pd.isna(n):
        return "N/A"
    n = float(n)
    if abs(n) >= 1e9:
        return f"${n/1e9:.{decimals}f}B"
    if abs(n) >= 1e6:
        return f"${n/1e6:.{decimals}f}M"
    if abs(n) >= 1e3:
        return f"${n/1e3:.{decimals}f}K"
    return f"${n:.0f}"


def fmt_pct(n, decimals: int = 1, show_sign: bool = True) -> str:
    """Format a number as a percentage."""
    if pd.isna(n):
        return "N/A"
    fmt = f"+.{decimals}f" if show_sign else f".{decimals}f"
    return f"{n:{fmt}}%"


def fmt_count(n) -> str:
    """Format a count with K/M/B suffix."""
    if pd.isna(n):
        return "N/A"
    n = float(n)
    if abs(n) >= 1e9:
        return f"{n/1e9:.1f}B"
    if abs(n) >= 1e6:
        return f"{n/1e6:.1f}M"
    if abs(n) >= 1e3:
        return f"{n/1e3:.1f}K"
    return f"{n:.0f}"


# ── Quick-use helpers ──────────────────────────────────────────────

def add_period_comparisons(df: pd.DataFrame, value_col: str, date_col: str = 'day') -> pd.DataFrame:
    """Add WoW and MoM growth columns to a daily time series DataFrame."""
    df = df.sort_values(date_col).copy()
    df[f'{value_col}_7d_ago'] = df[value_col].shift(7)
    df[f'{value_col}_28d_ago'] = df[value_col].shift(28)
    df['wow_growth_pct'] = (df[value_col] / df[f'{value_col}_7d_ago'] - 1) * 100
    df['mom_growth_pct'] = (df[value_col] / df[f'{value_col}_28d_ago'] - 1) * 100
    return df


def add_rolling_avg(df: pd.DataFrame, value_col: str, windows: list = [7, 28]) -> pd.DataFrame:
    """Add rolling average columns to a time series DataFrame."""
    df = df.copy()
    for w in windows:
        df[f'{value_col}_rolling_{w}d'] = df[value_col].rolling(w, min_periods=1).mean()
    return df


if __name__ == '__main__':
    # Test with sample data
    sample_results = [
        {'day': '2025-01-01', 'country': 'US', 'payment_count': '1234', 'volume_usd': '98765.43'},
        {'day': '2025-01-02', 'country': 'US', 'payment_count': '1456', 'volume_usd': '112345.67'},
        {'day': '2025-01-01', 'country': 'GB', 'payment_count': '456', 'volume_usd': '34567.89'},
        {'day': '2025-01-02', 'country': 'GB', 'payment_count': '512', 'volume_usd': '41234.56'},
    ]

    df = hubble_to_df(sample_results)
    print("\nSample output:")
    print(df)
    print(f"\nFormatted volume: {fmt_usd(df['volume_usd'].sum())}")
