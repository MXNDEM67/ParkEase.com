document.addEventListener("DOMContentLoaded", async () => {
  const entryForm = document.querySelector("#vehicleEntryForm");
  const plateNumber = document.querySelector("#vehicleNumber");
  const parkingSpace = document.querySelector("#parkingSpace");
  const summarySpace = document.querySelector("#summarySpace");
  const hourlyRateDisplay = document.querySelector("#hourlyRateDisplay");
  const feedback = document.querySelector("#entryFeedback");

  function populateAvailableSpaces() {
    if (!parkingSpace) return;

    const selectedValue = parkingSpace.value;
    const availableSpaces = window.ParkEaseParking.getSpaces().filter(
      (space) => space.status === "available",
    );
    parkingSpace.innerHTML = '<option value="">Select a space</option>';

    availableSpaces.forEach((space) => {
      const option = document.createElement("option");
      option.value = space.id;
      option.textContent = space.id;
      parkingSpace.appendChild(option);
    });

    if (availableSpaces.some((space) => space.id === selectedValue)) {
      parkingSpace.value = selectedValue;
    }
    updateSummary();
  }

  function updateSummary() {
    if (summarySpace) summarySpace.textContent = parkingSpace?.value || "--";
    if (hourlyRateDisplay) {
      hourlyRateDisplay.textContent = `GHS ${window.ParkEaseParking.getSettings().hourlyRate.toFixed(2)} / hour`;
    }
  }

  function showFeedback(message, isError = false) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("error", isError);
    feedback.classList.add("visible");
  }

  await window.ParkEaseParking.syncFromServer();
  populateAvailableSpaces();

  parkingSpace?.addEventListener("change", updateSummary);
  window.addEventListener("storage", (event) => {
    if (event.key === window.ParkEaseParking.storageKey) {
      populateAvailableSpaces();
    }
    if (event.key === window.ParkEaseParking.settingsStorageKey) {
      updateSummary();
    }
  });

  entryForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const plate = plateNumber?.value.trim().toUpperCase();

    if (!plate) {
      showFeedback("Enter the vehicle registration number.", true);
      plateNumber?.focus();
      return;
    }
    if (!parkingSpace?.value) {
      showFeedback("Choose an available parking space.", true);
      return;
    }

    let session;
    try {
      session = await window.ParkEaseParking.startParkingSession(
        parkingSpace.value,
        plate,
      );
    } catch (error) {
      showFeedback(error.message || "Unable to connect to the parking service. Try again.", true);
      return;
    }

    if (!session) {
      const existing = window.ParkEaseParking.getActiveSessions().find(
        (item) => item.plateNumber === plate,
      );
      showFeedback(
        existing
          ? `This vehicle already has an active session in ${existing.parkingSpace}.`
          : "That space is no longer available. Choose another space.",
        true,
      );
      populateAvailableSpaces();
      return;
    }

    showFeedback(`Parking started in ${session.parkingSpace}. The timer is running. Pay when you return to collect the vehicle.`);
    entryForm.reset();
    await window.ParkEaseParking.syncFromServer();
    populateAvailableSpaces();
  });
});