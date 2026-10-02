document.addEventListener("DOMContentLoaded", async () => {
  let ticket;
  try {
    ticket = JSON.parse(localStorage.getItem("parkEaseTicket"));
  } catch {
    ticket = null;
  }

  if (!ticket || typeof ticket !== "object" || !ticket.ticketNumber) {
    window.location.href = "entry.html";
    return;
  }

  setText("#ticketNumber", ticket.ticketNumber);
  setText("#ticketVehicle", ticket.plateNumber);
  setText("#ticketSpace", ticket.parkingSpace);
  setText("#ticketDuration", ticket.duration || `${ticket.hours} hour${ticket.hours === 1 ? "" : "s"}`);
  setText("#ticketAmount", `GHS ${Number(ticket.amount).toFixed(2)}`);
  setText("#ticketPaymentMethod", formatPayment(ticket.paymentMethod));
  setText("#ticketEntryTime", formatDate(ticket.entryTime));
  setText("#ticketPaidAt", formatDate(ticket.paidAt));

  const downloadButton = document.querySelector("#downloadTicket");
  const feedback = document.querySelector("#ticketFeedback");
  let qrCanvas;

  try {
    qrCanvas = await createTicketQr(ticket);
    const qrContainer = document.querySelector("#ticketQRCode");
    qrContainer.replaceChildren(qrCanvas);
    qrContainer.setAttribute("aria-label", `QR code for ticket ${ticket.ticketNumber}`);
    if (downloadButton) downloadButton.disabled = false;
  } catch (error) {
    if (feedback) {
      feedback.textContent = "The QR code could not be generated. Check your connection and reload this ticket.";
    }
    if (downloadButton) downloadButton.disabled = true;
    console.error("Ticket QR generation failed.", error);
  }

  downloadButton?.addEventListener("click", async () => {
    if (!qrCanvas) return;
    downloadButton.disabled = true;
    if (feedback) feedback.textContent = "Preparing your ticket download…";

    try {
      const ticketCanvas = drawTicket(ticket, qrCanvas);
      const blob = await canvasToBlob(ticketCanvas);
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${safeFilename(ticket.ticketNumber)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      if (feedback) feedback.textContent = "Ticket downloaded.";
    } catch (error) {
      if (feedback) feedback.textContent = "The ticket could not be downloaded. Please try again.";
      console.error("Ticket download failed.", error);
    } finally {
      downloadButton.disabled = false;
    }
  });
});

function createTicketQr(ticket) {
  if (typeof window.QRCode !== "function") {
    return Promise.reject(new Error("QR code generator did not load."));
  }

  const qrData = JSON.stringify({
    type: "parkease-ticket",
    ticketNumber: ticket.ticketNumber,
    plateNumber: ticket.plateNumber,
    parkingSpace: ticket.parkingSpace,
    duration: ticket.duration,
    amount: Number(ticket.amount),
    paymentMethod: ticket.paymentMethod,
    paidAt: ticket.paidAt,
    status: ticket.status,
  });
  const holder = document.createElement("div");
  holder.className = "qr-render-target";
  document.body.appendChild(holder);

  try {
    new window.QRCode(holder, {
      text: qrData,
      width: 240,
      height: 240,
      correctLevel: window.QRCode.CorrectLevel.M,
    });

    const canvas = holder.querySelector("canvas");
    if (!canvas) throw new Error("QR code generator returned no canvas.");
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    output.getContext("2d").drawImage(canvas, 0, 0);
    holder.remove();
    return Promise.resolve(output);
  } catch (error) {
    holder.remove();
    return Promise.reject(error);
  }
}

function drawTicket(ticket, qrCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 980;
  const context = canvas.getContext("2d");

  context.fillStyle = "#eef2f7";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(40, 40, 820, 900);
  context.fillStyle = "#1479ff";
  context.fillRect(40, 40, 12, 900);

  context.fillStyle = "#101620";
  context.font = "700 38px Arial, sans-serif";
  context.fillText("ParkEase", 85, 112);
  context.fillStyle = "#15803d";
  context.font = "700 20px Arial, sans-serif";
  context.fillText("PAID", 760, 106);
  context.fillStyle = "#748092";
  context.font = "16px Arial, sans-serif";
  context.fillText("SMART PARKING RECEIPT", 85, 144);
  drawDivider(context, 80, 175, 820);

  context.fillStyle = "#748092";
  context.font = "700 15px Arial, sans-serif";
  context.fillText("TICKET NUMBER", 85, 215);
  context.fillStyle = "#1479ff";
  context.font = "700 34px Arial, sans-serif";
  context.fillText(String(ticket.ticketNumber), 85, 258);
  drawDivider(context, 80, 285, 820);

  const detailRows = [
    ["VEHICLE", ticket.plateNumber || "--", "PARKING SPACE", ticket.parkingSpace || "--"],
    ["PARKED FOR", ticket.duration || `${ticket.hours} hour${ticket.hours === 1 ? "" : "s"}`, "PAYMENT METHOD", formatPayment(ticket.paymentMethod)],
    ["ENTRY TIME", formatDate(ticket.entryTime), "PAID AT", formatDate(ticket.paidAt)],
  ];
  let rowY = 330;
  detailRows.forEach(([leftLabel, leftValue, rightLabel, rightValue]) => {
    context.fillStyle = "#748092";
    context.font = "700 14px Arial, sans-serif";
    context.fillText(leftLabel, 85, rowY);
    context.fillText(rightLabel, 475, rowY);
    context.fillStyle = "#101620";
    context.font = "600 19px Arial, sans-serif";
    context.fillText(String(leftValue), 85, rowY + 31, 350);
    context.fillText(String(rightValue), 475, rowY + 31, 340);
    rowY += 88;
  });

  drawDivider(context, 80, 602, 820);
  context.fillStyle = "#748092";
  context.font = "700 15px Arial, sans-serif";
  context.fillText("TOTAL PAID", 85, 643);
  context.fillStyle = "#1479ff";
  context.font = "700 32px Arial, sans-serif";
  context.fillText(`GHS ${Number(ticket.amount).toFixed(2)}`, 85, 687);

  context.fillStyle = "#ffffff";
  context.fillRect(570, 620, 230, 230);
  context.drawImage(qrCanvas, 580, 630, 210, 210);
  context.fillStyle = "#748092";
  context.font = "14px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("Scan to read ticket details", 685, 875);
  context.fillText("Thank you for using ParkEase", 450, 915);
  return canvas;
}

function drawDivider(context, x, y, width) {
  context.strokeStyle = "#cfd5dd";
  context.setLineDash([7, 6]);
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.stroke();
  context.setLineDash([]);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Browser could not encode the ticket image."));
    }, "image/png");
  });
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, "_") || "parkease-ticket";
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value || "--";
}

function formatPayment(method) {
  if (method === "cash") return "Cash";
  if (method === "online") return "Online Payment";
  return method || "--";
}

function formatDate(dateString) {
  if (!dateString) return "--";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleString("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
