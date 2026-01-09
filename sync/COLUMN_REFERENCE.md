# SQL Server Stored Procedure Column Reference

## gen_opnl_yld_rpt_data (Yield Data)

This stored procedure returns yield/inventory data for operational reporting.

### Columns Used

| Index | Column Name | Description | Used |
|-------|-------------|-------------|------|
| 0 | prdt_clss_cde | Numeric code for product classification | No |
| 1 | prdt_clss_alfa_nme | Alpha name for product class | Yes |
| 4 | smry_prdt_nme | Summary product name | Yes |
| 5 | oi_qty | Opening inventory quantity | Yes |
| 6 | rec_qty | Receipts quantity | Yes |
| 7 | ship_qty | Shipments quantity | Yes |
| 8 | blend_qty | Blend quantity | Yes |
| 9 | ci_qty | Closing inventory quantity | Yes |

### Product Classification (prdt_clss_alfa_nme)

| Class Code | Meaning | Description |
|------------|---------|-------------|
| F | Feedstock | Crude oil and other input materials |
| P | Product | Output products from refining process |

**Examples:**
- **Feedstock (F):** CRUDE HVY, CRUDE LT, HATTERSPND, LMS CRUDE, JAY, N1540
- **Product (P):** SULFUR, COMLPG, I-BUTANE, COMM PROPANE, MOBPROP, N-BUTANE, ULS DIESEL, JET FUEL, etc.

### Product Sort Codes (Not Currently Used)

#### smry_prdt_sort_1_cde
Primary sort code that groups products by category:

| Code | Category |
|------|----------|
| A | Crude |
| C | LPG |
| G | Gasoline |
| N | Jet |
| O | Diesel/Distillate |
| ... | (other categories may exist) |

#### smry_prdt_sort_2_cde
Secondary sort code for finer categorization within the primary group. Purpose and values are not fully documented.

### Yield Calculation

```
yield_qty = blend_qty + ci_qty - oi_qty - rec_qty + ship_qty
```

Where:
- `blend_qty` = Volume blended into product
- `ci_qty` = Closing inventory
- `oi_qty` = Opening inventory
- `rec_qty` = Receipts
- `ship_qty` = Shipments

### Notes on Intermediate Feeds

Some products like UMO VGO are intermediate feeds that produce other products (ULSD, BASE OIL). In reports, these intermediate feeds show as **negative values** because they are consumed to produce other products. The yield calculation formula handles this automatically.

---

## gen_ship_by_prdt_sum_data (Sales Data)

This stored procedure returns sales/shipment data.

### Columns

| Index | Column Name | Description | Used |
|-------|-------------|-------------|------|
| 0 | prdt_nme | Product name | Yes |
| 1 | prdt_desc_txt | Product description | Yes |
| 2 | cust_nme | Customer name | Yes |
| 3 | trns_type_cde | Transaction type code | Yes |
| 4 | vol_qty_tr | Volume - Truck (gallons) | Yes |
| 5 | vol_qty_h2o | Volume - H2O/Water (gallons) | Yes |
| 6 | vol_qty_pl | Volume - Pipeline (gallons) | Yes |
| 7 | vol_qty_os | Volume - Other/OS (gallons) | Yes |

**Note:** Volumes are converted from gallons to barrels by dividing by 42.

---

## Future Enhancements (TODO)

### yield_pct (Yield Percent)

Calculate each product's yield as a percentage of total crude rate:

```
yield_pct = (product_yield / crude_rate) * 100
```

Example: CBOB yield percent = CBOB yield / Total Crude Rate * 100

This would allow for percentage-based comparisons across different production levels.
