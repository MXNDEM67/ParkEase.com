document.addEventListener("DOMContentLoaded", async () => {
  const searchForm = document.querySelector("#sessionSearchForm");
  const vehicleLookup = document.querySelector("#vehicleLookup");
  const emptyState = document.querySelector("#sessionEmpty");
  const sessionDetails = document.querySelector("#sessionDetails");
  const completeButton = document.querySelector("#completeExit");
  const feedback = document.querySelector("#exitFeedback");
  let selectedSession = null;

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function formatDate(value) {
    return new Date(value).toLocaleString("en-GH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function showFeedback(message, isError = false) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("error", isError);
  }

  function updateCharge() {
    if (!selectedSession) return;
    const charge = window.ParkEaseParking.getCharge(selectedSession);
    const settings = window.ParkEaseParking.getSettings();
    setText("#billableHours", `${charge.hours} hour${charge.hours === 1 ? "" : "s"}`);
    setText("#checkoutRate", `GHS ${settings.hourlyRate.toFixed(2)}`);
    setText("#exitAmount", `GHS ${charge.amount.toFixed(2)}`);
  }

  function showSession(session) {
    selectedSession = session;
    emptyState?.classList.add("hidden");
    sessionDetails?.classList.remove("hidden");
    setText("#exitVehicle", session.plateNumber);
    setText("#exitSpace", session.parkingSpace);
    setText("#exitEntryTime", formatDate(session.startedAt));
    const timer = document.querySelector("#elapsedTimer");
    if (timer) timer.dataset.startedAt = session.startedAt;
    document.querySelectorAll('input[name="checkoutMethod"]').forEach((input) => {
      const enabled = window.ParkEaseParking.getSettings().paymentMethods[input.value];
      input.disabled = !enabled;
      input.closest("label").hidden = !enabled;
      input.checked = false;
    });
    if (completeButton) completeButton.disabled = true;
    updateCharge();
    showFeedback("");
  }

  await window.ParkEaseParking.syncFromServer();

  searchForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const lookup = vehicleLookup?.value.trim();

    if (!lookup) {
      showFeedback("Enter a vehicle registration or parking space.", true);
      return;
    }

    try {
      const session = await window.ParkEaseParking.lookupSession(lookup);
      showSession(session);
    } catch (error) {
      selectedSession = null;
      sessionDetails?.classList.add("hidden");
      emptyState?.classList.remove("hidden");
      showFeedback(error.message || "No active parking session matches that plate or space.", true);
    }
  });

  document.querySelectorAll('input[name="checkoutMethod"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (completeButton) completeButton.disabled = !input.checked;
      showFeedback("");
    });
  });

  window.setInterval(updateCharge, 1000);

  window.addEventListener("storage", (event) => {
    if (
      selectedSession &&
      (event.key === window.ParkEaseParking.sessionsStorageKey ||
        event.key === window.ParkEaseParking.settingsStorageKey)
    ) {
      const latest = window.ParkEaseParking.getActiveSessions().find(
        (session) => session.sessionId === selectedSession.sessionId,
      );
      if (latest) showSession(latest);
    }
  });

  completeButton?.addEventListener("click", async () => {
    const method = document.querySelector('input[name="checkoutMethod"]:checked');
    if (!selectedSession || !method) {
      showFeedback("Choose a payment method to complete checkout.", true);
      return;
    }

    try {
      const ticket = await window.ParkEaseParking.completeParkingSession(
        selectedSession.sessionId,
        method.value,
      );
      if (!ticket) {
        throw new Error("Could not complete checkout. Refresh the session and try again.");
      }
      window.location.href = "ticket.html";
    } catch (error) {
      showFeedback(error.message || "Could not complete checkout. Refresh the session and try again.", true);
    }
  });
});
