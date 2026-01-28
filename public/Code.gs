/***********************
 * CONFIG
 ***********************/
const SPREADSHEET_ID = "1czjZ_57nuRGeYKaHP_K7KJjnsD3b6ln7tGDLeiaY1bA";
const SHEET_NAME = "Orders";
const ADMIN_EMAIL = "healthymealspot@gmail.com";
const LOGO_FILE_ID = "1jPLYUIycwTjUDyMrW7IWf5lNBQkQRpDA";

const UPI_ID = "9594614752@pthdfc";
const UPI_PAYEE_NAME = "RAY D";


/***********************
 * doGet – HEALTH CHECK + PAYMENT DATA API
 ***********************/
function doGet(e) {

  // 🔹 PAYMENT DATA API
  if (e && e.parameter && e.parameter.action === "payment") {

    const orderId = e.parameter.orderId;
    if (!orderId) {
      return jsonResponse({ success: false, error: "Missing orderId" });
    }

    const sheet = SpreadsheetApp
      .openById(SPREADSHEET_ID)
      .getSheetByName(SHEET_NAME);

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];

    const idCol = headers.indexOf("Order ID");
    const totalCol = headers.indexOf("Total (Rs)");
    const paymentCol = headers.indexOf("Payment Status");

    let row = null;

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idCol]) === String(orderId)) {
        row = rows[i];
        break;
      }
    }

    if (!row) {
      return jsonResponse({ success: false, error: "Order not found" });
    }

    if (row[paymentCol] === "Paid") {
      return jsonResponse({ success: false, error: "Payment already completed" });
    }

    return jsonResponse({
      success: true,
      orderId: orderId,
      amount: row[totalCol],
      upiId: UPI_ID,
      payeeName: UPI_PAYEE_NAME
    });
  }

  // 🔹 HEALTH CHECK
  return ContentService.createTextOutput("OK");
}


/***********************
 * JSON HELPER
 ***********************/
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/***********************
 * doPost – ORDER WRITE + ADMIN EMAIL
 ***********************/
function doPost(e) {
  try {
    const data = JSON.parse(e.parameter.order);

    const sheet = SpreadsheetApp
      .openById(SPREADSHEET_ID)
      .getSheetByName(SHEET_NAME);

    // Force Extras column as TEXT
    sheet.getRange(2, 9, sheet.getMaxRows()).setNumberFormat("@");

  sheet.appendRow([
    String(data.orderId),
    String(data.orderDate),
    String(data.orderTime),
    String(data.orderFor),
    String(data.customer),
    String(data.phone),
    String(data.address),
    String(data.items),
    data.extras ? "\u200B" + data.extras : "",
    String(data.total),
    "Pending",
    "Pending",
    new Date(),
    "Deep",
    "New",
    "",
    "",
    "",
    data.couponCode || "",
    Number(data.couponDiscount) || 0
  ]);

    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: `🧾 New Order – ${data.orderId}`,
      body:
        `Order ID: ${data.orderId}\n` +
        `Customer: ${data.customer}\n` +
        `Phone: ${data.phone}\n` +
        `Items: ${data.items}\n` +
        `Total: ₹${data.total}`
    });

    return jsonResponse({ success: true });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}


/***********************
 * AUTO INVOICE / RECEIPT
 ***********************/
function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  const row = e.range.getRow();
  if (row === 1) return;

  const orderStatus = sheet.getRange(row, 15).getValue();
  const payment = sheet.getRange(row, 11).getValue();
  const delivery = sheet.getRange(row, 12).getValue();

  const invoiceCell = sheet.getRange(row, 16);
  const receiptCell = sheet.getRange(row, 17);
  const messageCell = sheet.getRange(row, 18);

  const orderId = sheet.getRange(row, 1).getValue();
  const customerName = sheet.getRange(row, 5).getValue();

  // 🔹 INVOICE
  if (orderStatus === "Confirmed") {
    if (!invoiceCell.getValue()) {
      invoiceCell.setValue(generateInvoicePdf(orderId));
    }

    const paymentLink = "https://healthymealspot.com/pay.html?o=" + orderId;

    messageCell.setValue(
      generateInvoiceMessage(
        customerName,
        invoiceCell.getValue(),
        paymentLink
      )
    );
  }

  // 🔹 RECEIPT
  if (payment === "Paid" && delivery === "Delivered") {
    if (!receiptCell.getValue()) {
      receiptCell.setValue(generateReceiptPdf(orderId));
    }

    messageCell.setValue(
      generateCustomerMessage(customerName, receiptCell.getValue())
    );
  }
}


/***********************
 * PDF – INVOICE
 ***********************/
function generateInvoicePdf(orderId) {
  const { order, logo } = getOrderData(orderId);

  const upiLink =
    "upi://pay" +
    "?pa=" + UPI_ID +
    "&pn=" + UPI_PAYEE_NAME +
    "&am=" + order.total +
    "&cu=INR" +
    "&tn=Invoice " + order.id;

  order.upiLink = upiLink;
  order.upiQr = generateUpiQrBase64(upiLink);

  const template = HtmlService.createTemplateFromFile("Invoice");
  template.order = order;
  template.logo = logo;

  return renderPdf(template, "Invoices", `${orderId}-invoice.pdf`);
}


/***********************
 * PDF – RECEIPT
 ***********************/
function generateReceiptPdf(orderId) {
  const { order, logo } = getOrderData(orderId);

  const template = HtmlService.createTemplateFromFile("Receipt");
  template.order = order;
  template.logo = logo;

  return renderPdf(template, "Receipts", `${orderId}-receipt.pdf`);
}


/***********************
 * SHARED HELPERS
 ***********************/
function getOrderData(orderId) {
  const sheet = SpreadsheetApp
    .openById(SPREADSHEET_ID)
    .getSheetByName(SHEET_NAME);

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];

  let row;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(orderId)) {
      row = rows[i];
      break;
    }
  }

  if (!row) throw new Error("Order not found");

  const o = {};
  headers.forEach((h, i) => o[h] = row[i]);

  const logoBlob = DriveApp.getFileById(LOGO_FILE_ID).getBlob();
  const logoBase64 = Utilities.base64Encode(logoBlob.getBytes());

  return {
    logo: `data:image/png;base64,${logoBase64}`,
    order: {
      id: o["Order ID"],
      date: Utilities.formatDate(
        new Date(o["Order Date"]),
        Session.getScriptTimeZone(),
        "dd MMM yyyy"
      ),
      customer: o["Customer Name"],
      phone: o["Customer Phone"],
      address: o["Customer Address"],
      items: normalizeItems(o["Items"]),
      extras: parseExtras(o["Extras"]),
      total: o["Total (Rs)"]
    }
  };
}


/***********************
 * PDF RENDER
 ***********************/
function renderPdf(template, folderName, fileName) {
  const html = template.evaluate().getContent();

  const pdfBlob = Utilities
    .newBlob(html, "text/html")
    .getAs("application/pdf")
    .setName(fileName);

  const folder = DriveApp.getFoldersByName(folderName).hasNext()
    ? DriveApp.getFoldersByName(folderName).next()
    : DriveApp.createFolder(folderName);

  const file = folder.createFile(pdfBlob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return file.getUrl();
}


/***********************
 * QR
 ***********************/
function generateUpiQrBase64(upiLink) {
  const res = UrlFetchApp.fetch(
    "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" +
    encodeURIComponent(upiLink)
  );

  return "data:image/png;base64," +
    Utilities.base64Encode(res.getBlob().getBytes());
}


/***********************
 * MESSAGE TEMPLATES
 ***********************/
function generateInvoiceMessage(name, invoiceUrl, paymentLink) {
  return (
    `Hi ${name} 😊\n\n` +
    `Your order has been confirmed! 🎉\n\n` +
    `🧾 Invoice:\n${invoiceUrl}\n\n` +
    `💳 Pay here 👇\n${paymentLink}\n\n` +
    `Tap the link to pay using GPay / PhonePe / Paytm / BHIM\n\n` +
    `— Mr & Mrs Ray 💛`
  );
}

function generateCustomerMessage(name, receiptUrl) {
  return (
    `Hi ${name} 😊\n` +
    `Here’s your receipt:\n${receiptUrl}\n\n` +
    `Thank you for ordering with us 💛`
  );
}


/***********************
 * UTILITIES
 ***********************/
function normalizeItems(raw) {
  if (!raw) return "";
  return String(raw)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .join("\n");
}

function parseExtras(raw) {
  if (!raw) return [];
  return String(raw)
    .replace(/\u200B/g, "")
    .split(/\r?\n/)
    .map(l => {
      const m = l.match(/₹\s*(-?\d+(?:\.\d+)?)/);
      return m
        ? { label: l.replace(/₹.*$/, "").trim(), amount: Number(m[1]) }
        : null;
    })
    .filter(Boolean);
}
