document.addEventListener("DOMContentLoaded", async () => {
  await window.ParkEaseParking.syncFromServer({ includeTickets: true });
  initializeSettingsForm();

  const tickets = window.ParkEaseParking.getActiveTickets();
  const sessions = window.ParkEaseParking.getActiveSessions();
  const spaces = window.ParkEaseParking.getSpaces();

  renderTable(
    "vehicleTable",
    sessions,
    (session) => [
      session.plateNumber,
      session.parkingSpace,
      formatDate(session.startedAt),
      window.ParkEaseParking.formatDuration(Date.now() - new Date(session.startedAt).getTime()),
      "PARKED",
    ],
    "No vehicles currently parked.",
  );

  renderTable(
    "ticketTable",
    tickets,
    (ticket) => [
      ticket.ticketNumber,
      ticket.plateNumber,
      ticket.parkingSpace,
      formatDate(ticket.entryTime),
      formatDate(ticket.paidAt),
      ticket.status,
    ],
    "No active tickets.",
  );

  renderTable(
    "paymentTable",
    tickets,
    (ticket) => [
      `PAY-${ticket.ticketNumber}`,
      ticket.ticketNumber,
      ticket.paymentMethod === "cash" ? "Cash" : "Online",
      `GHS ${Number(ticket.amount || 0).toFixed(2)}`,
      formatDate(ticket.paidAt),
    ],
    "No payment records available.",
  );

  const cashTotal = tickets
    .filter((ticket) => ticket.paymentMethod === "cash")
    .reduce((total, ticket) => total + Number(ticket.amount || 0), 0);
  const onlineTotal = tickets
    .filter((ticket) => ticket.paymentMethod !== "cash")
    .reduce((total, ticket) => total + Number(ticket.amount || 0), 0);
  const activeValue = cashTotal + onlineTotal;

  setText("#cashPayments", `GHS ${cashTotal.toFixed(2)}`);
  setText("#onlinePayments", `GHS ${onlineTotal.toFixed(2)}`);
  setText("#reportVehicles", sessions.length);
  setText("#reportTickets", tickets.length);
  setText("#reportValue", `GHS ${activeValue.toFixed(2)}`);
  setText(
    "#reportAvailable",
    spaces.filter((space) => space.status === "available").length,
  );
});

function initializeSettingsForm() {
  const form = document.querySelector("#systemSettingsForm");
  if (!form) return;

  const hourlyRate = document.querySelector("#hourlyRate");
  const cashMethod = document.querySelector("#enableCash");
  const onlineMethod = document.querySelector("#enableOnline");
  const feedback = document.querySelector("#settingsFeedback");

  function loadSettings() {
    const settings = window.ParkEaseParking.getSettings();
    hourlyRate.value = settings.hourlyRate;
    cashMethod.checked = settings.paymentMethods.cash;
    onlineMethod.checked = settings.paymentMethods.online;
  }

  loadSettings();
  window.addEventListener("storage", (event) => {
    if (event.key === window.ParkEaseParking.settingsStorageKey) loadSettings();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";

    if (!form.reportValidity()) return;

    try {
      await window.ParkEaseParking.saveSettings({
        hourlyRate: hourlyRate.value,
        paymentMethods: {
          cash: cashMethod.checked,
          online: onlineMethod.checked,
        },
      });
      feedback.textContent = "Settings saved.";
    } catch (error) {
      feedback.textContent = error.message;
    }
  });
}

function renderTable(tableId, records, getCells, emptyMessage) {
  const body = document.querySelector(`#${tableId}`);
  if (!body) return;

  body.replaceChildren();

  if (records.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = body.closest("table").querySelectorAll("thead th").length;
    cell.className = "empty-table";
    cell.textContent = emptyMessage;
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("tr");
    getCells(record).forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value || "--";
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

function formatDate(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}
