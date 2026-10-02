document.addEventListener("DOMContentLoaded", async () => {
  const menuToggle = document.querySelector(".menu-toggle");
  const navLinks = document.querySelector(".nav-links");

  if (menuToggle && navLinks) {
    menuToggle.addEventListener("click", () => {
      const isOpen = navLinks.classList.toggle("active");
      menuToggle.classList.toggle("active", isOpen);
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      menuToggle.setAttribute(
        "aria-label",
        isOpen ? "Close navigation menu" : "Open navigation menu",
      );
    });

    navLinks.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("active");
        menuToggle.classList.remove("active");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Open navigation menu");
      });
    });
  }

  await window.ParkEaseParking.syncFromServer();

  const yearElements = document.querySelectorAll("#currentYear");
  yearElements.forEach((element) => {
    element.textContent = new Date().getFullYear();
  });

  function updatePublicRates() {
    const settings = window.ParkEaseParking.getSettings();
    const publicRate = document.querySelector("#publicHourlyRate");
    if (publicRate) publicRate.textContent = settings.hourlyRate.toFixed(2);
  }

  updatePublicRates();
  window.addEventListener("storage", (event) => {
    if (event.key === window.ParkEaseParking.settingsStorageKey) {
      updatePublicRates();
    }
  });

  const parkingGrid = document.querySelector("#parkingGrid");

  const renderSpaces = () => {
    const spaces = window.ParkEaseParking.getSpaces();

    if (parkingGrid) {
      parkingGrid.innerHTML = "";

      spaces.forEach((space) => {
        const card = document.createElement("div");
        card.className = `parking-space ${space.status}`;
        card.innerHTML = `
                <div class="space-icon">
                    <i class="bi bi-car-front-fill"></i>
                </div>

                <strong>${space.id}</strong>

                <span>
                    ${space.status === "available" ? "Available" : "Occupied"}
                </span>
            `;

        if (space.status === "occupied") {
          card.title = `Occupied by ${space.vehicle}`;
          const vehicle = document.createElement("small");
          vehicle.textContent = space.vehicle;
          card.appendChild(vehicle);
          const elapsed = document.createElement("small");
          elapsed.className = "parking-elapsed";
          elapsed.dataset.startedAt = space.startedAt;
          elapsed.textContent = window.ParkEaseParking.formatDuration(
            Date.now() - new Date(space.startedAt).getTime(),
          );
          card.appendChild(elapsed);
        }

        parkingGrid.appendChild(card);
      });
    }

    updateParkingCounters(spaces);
    const progressBar = document.querySelector("#availabilityBar");
    if (progressBar) {
      const available = spaces.filter((space) => space.status === "available").length;
      const availability = spaces.length ? (available / spaces.length) * 100 : 0;
      progressBar.style.width = `${availability}%`;
      progressBar.setAttribute("aria-valuenow", String(available));
    }
  };

  renderSpaces();
  window.addEventListener("storage", (event) => {
    if (event.key === window.ParkEaseParking.storageKey) renderSpaces();
  });

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetId = link.getAttribute("href");

      if (targetId === "#") return;

      const target = document.querySelector(targetId);

      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
});

/* =========================
   PARKING COUNTERS
========================= */
function updateParkingCounters(spaces) {
  const available = spaces.filter(
    (space) => space.status === "available",
  ).length;

  const occupied = spaces.filter((space) => space.status === "occupied").length;

  const availableElement = document.querySelector("#availableCount");
  const publicAvailableElement = document.querySelector("#availableSpaces");
  const occupiedElement = document.querySelector("#occupiedCount");
  const totalElement = document.querySelector("#totalCount");

  if (availableElement) {
    availableElement.textContent = available;
  }

  if (publicAvailableElement) {
    publicAvailableElement.textContent = available;
  }

  const summaryElement = document.querySelector("#totalAvailable");
  if (summaryElement) {
    summaryElement.textContent = available;
  }

  if (occupiedElement) {
    occupiedElement.textContent = occupied;
  }

  if (totalElement) {
    totalElement.textContent = spaces.length;
  }
}

/* =========================
   TOAST MESSAGE
========================= */
function showToast(message, type = "success") {
  let toast = document.querySelector("#parkEaseToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "parkEaseToast";
    document.body.appendChild(toast);
  }

  toast.className = `park-toast ${type}`;
  toast.innerHTML = `
        <i class="bi ${
          type === "success"
            ? "bi-check-circle-fill"
            : "bi-exclamation-circle-fill"
        }"></i>

        <span>${message}</span>
    `;

  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}
