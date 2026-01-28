function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GEO_NOT_SUPPORTED"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      },
      err => {
        reject(new Error("GEO_FAILED_" + err.code));
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  });
}

async function calculateDeliveryFromLocation() {
  let location;

  try {
    location = await getUserLocation();
  } catch (e) {
    throw e; // GPS error only
  }

  const res = await fetch("/api/delivery-charge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(location)
  });

  if (!res.ok) {
    throw new Error("DELIVERY_API_FAILED");
  }

  return res.json();
}
