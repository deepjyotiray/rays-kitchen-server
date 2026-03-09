import os, glob

replacements = [
    # HTML entity variants
    ("Mr &amp; Mrs Ray&#39;s Home Kitchen", "Healthy Meal Spot"),
    ("Mr &amp; Mrs Ray&#39;s",             "Healthy Meal Spot"),
    # Plain text variants
    ("Mr & Mrs Ray's Home Kitchen",        "Healthy Meal Spot"),
    ("Mr & Mrs Ray's Kitchen",             "Healthy Meal Spot"),
    ("Mr & Mrs Ray's",                     "Healthy Meal Spot"),
    ("Mr & Mrs Ray",                       "Healthy Meal Spot"),
    # PDF download filename
    ("Mr_Mrs_Ray_Menu.pdf",                "HealthyMealSpot_Menu.pdf"),
    # Page titles that already say HealthyMealSpot (leave as-is, but normalise spacing)
    ("HealthyMealSpot",                    "Healthy Meal Spot"),
]

files = glob.glob("/Users/deepjyotiray/Documents/FoodWebsite/rays-home-kitchen/public/**/*.html", recursive=True)
files += glob.glob("/Users/deepjyotiray/Documents/FoodWebsite/rays-home-kitchen/public/*.html")

seen = set()
for f in files:
    if f in seen:
        continue
    seen.add(f)
    txt = open(f).read()
    orig = txt
    for old, new in replacements:
        txt = txt.replace(old, new)
    if txt != orig:
        open(f, 'w').write(txt)
        print(f"Updated: {os.path.basename(f)}")

print("Done")
