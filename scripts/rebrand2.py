import glob, os

fixes = [
    ("Healthy Meal Spot's Home Kitchen", "Healthy Meal Spot"),
    ("Healthy Meal Spot's Kitchen",      "Healthy Meal Spot"),
    ("Healthy Meal Spot's",              "Healthy Meal Spot"),
    ("Healthy Meal Spot_Menu.pdf",       "HealthyMealSpot_Menu.pdf"),
]

files = glob.glob("/Users/deepjyotiray/Documents/FoodWebsite/rays-home-kitchen/public/**/*.html", recursive=True)
files += glob.glob("/Users/deepjyotiray/Documents/FoodWebsite/rays-home-kitchen/public/*.html")

seen = set()
for f in files:
    if f in seen: continue
    seen.add(f)
    txt = open(f).read()
    orig = txt
    for old, new in fixes:
        txt = txt.replace(old, new)
    if txt != orig:
        open(f, 'w').write(txt)
        print(f"Fixed: {os.path.basename(f)}")

print("Done")
