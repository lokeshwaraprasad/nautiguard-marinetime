"""
Builds data/boundary.geojson from the positions printed in the treaty texts.

The positions are typed below EXACTLY as printed (degrees and decimal minutes)
so anyone can compare this file line-by-line with the source documents:

* Agreement between Sri Lanka and India on the Boundary in Historic Waters
  between the two Countries and Related Matters, 26/28 June 1974, Article 1.
  https://www.un.org/Depts/los/LEGISLATIONANDTREATIES/PDFFILES/TREATIES/LKA-IND1974BW.PDF
* Agreement between Sri Lanka and India on the Maritime Boundary between the
  two Countries in the Gulf of Mannar and the Bay of Bengal and Related
  Matters, 23 March 1976, Articles 1 and 2.
  https://www.un.org/Depts/los/LEGISLATIONANDTREATIES/PDFFILES/TREATIES/LKA-IND1976MB.PDF

Run:  python scripts/build_boundary.py
"""

import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

# (label, lat_deg, lat_min, lon_deg, lon_min) -- all North / East.
BAY_OF_BENGAL_1976 = [
    ("Position 1b", 10, 5.0, 80, 3.0),
    ("Position 1ba", 10, 5.8, 80, 5.0),
    ("Position 1bb", 10, 8.4, 80, 9.5),
    ("Position 2b", 10, 33.0, 80, 46.0),   # printed as 10° 33' 0 N in the UN copy
    ("Position 3b", 10, 41.7, 81, 2.5),
    ("Position 4b", 11, 2.7, 81, 56.0),
    ("Position 5b", 11, 16.0, 82, 24.4),
    ("Position 6b", 11, 26.6, 83, 22.0),
]

PALK_STRAIT_1974 = [
    ("Position 1", 10, 5.0, 80, 3.0),
    ("Position 2", 9, 57.0, 79, 35.0),
    ("Position 3", 9, 40.15, 79, 22.60),
    ("Position 4", 9, 21.80, 79, 30.70),
    ("Position 5", 9, 13.0, 79, 32.0),
    ("Position 6", 9, 6.0, 79, 32.0),
]

GULF_OF_MANNAR_1976 = [
    ("Position 1m", 9, 6.0, 79, 32.0),
    ("Position 2m", 9, 0.0, 79, 31.3),
    ("Position 3m", 8, 53.8, 79, 29.3),
    ("Position 4m", 8, 40.0, 79, 18.2),    # longitude printed with an 'N' in the UN copy; it is East
    ("Position 5m", 8, 37.2, 79, 13.0),
    ("Position 6m", 8, 31.2, 79, 4.7),
    ("Position 7m", 8, 22.2, 78, 55.4),
    ("Position 8m", 8, 12.2, 78, 53.7),
    ("Position 9m", 7, 35.3, 78, 45.7),
    ("Position 10m", 7, 21.0, 78, 38.8),
    ("Position 11m", 6, 30.8, 78, 12.2),
    ("Position 12m", 5, 53.9, 77, 50.7),
    ("Position 13m", 5, 0.0, 77, 10.6),
]

SECTORS = [
    {
        "id": "bay-of-bengal-1976",
        "name": "Bay of Bengal sector (1976 Agreement, Art. 2)",
        "treaty": "Agreement on the Maritime Boundary in the Gulf of Mannar and the Bay of Bengal, 23 March 1976",
        "positions": BAY_OF_BENGAL_1976,
    },
    {
        "id": "palk-strait-1974",
        "name": "Palk Strait / historic waters sector (1974 Agreement, Art. 1)",
        "treaty": "Agreement on the Boundary in Historic Waters between the two Countries, 26/28 June 1974",
        "positions": PALK_STRAIT_1974,
    },
    {
        "id": "gulf-of-mannar-1976",
        "name": "Gulf of Mannar sector (1976 Agreement, Art. 1)",
        "treaty": "Agreement on the Maritime Boundary in the Gulf of Mannar and the Bay of Bengal, 23 March 1976",
        "positions": GULF_OF_MANNAR_1976,
    },
]


def to_decimal(deg: int, minutes: float) -> float:
    return round(deg + minutes / 60.0, 7)


def fmt(deg, minutes, hemi):
    return f"{deg:02d}° {minutes:05.2f}' {hemi}"


def build():
    features = []
    for sector in SECTORS:
        coords, points = [], []
        for label, la_d, la_m, lo_d, lo_m in sector["positions"]:
            lat, lon = to_decimal(la_d, la_m), to_decimal(lo_d, lo_m)
            coords.append([lon, lat])  # GeoJSON order is [longitude, latitude]
            points.append({
                "label": label,
                "as_printed": f"{fmt(la_d, la_m, 'N')}, {fmt(lo_d, lo_m, 'E')}",
                "lat": lat,
                "lon": lon,
            })
        features.append({
            "type": "Feature",
            "properties": {
                "id": sector["id"],
                "name": sector["name"],
                "treaty": sector["treaty"],
                "joining_rule": "arcs of great circles between positions, in sequence (as stated in the treaty)",
                "verification_status": "transcribed_from_treaty_text",
                "points": points,
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })

    collection = {
        "type": "FeatureCollection",
        "name": "India-Sri Lanka maritime boundary (1974 and 1976 agreements)",
        "crs_note": "Geographic latitude/longitude in decimal degrees. The treaties do not name a "
                    "geodetic datum; NautiGuard treats the values as WGS84 for display. See boundary_metadata.json.",
        "features": features,
    }
    out = DATA / "boundary.geojson"
    out.write_text(json.dumps(collection, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out} with {sum(len(f['geometry']['coordinates']) for f in features)} positions")


if __name__ == "__main__":
    build()
