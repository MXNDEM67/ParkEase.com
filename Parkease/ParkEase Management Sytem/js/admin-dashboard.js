document.addEventListener("DOMContentLoaded", async () => {
  try {
    const { admin } = await window.apiRequest("auth/me.php");
    localStorage.setItem(
      "parkEaseAdmin",
      JSON.stringify({
        id: admin.id,
        name: admin.name,
        email: admin.email,
        loggedIn: true,
        loginTime: new Date().toISOString(),
      }),
    );
    setText("#adminName", admin.name || admin.email || "Admin");
  } catch {
    localStorage.removeItem("parkEaseAdmin");
    window.location.href = "admin-login.html";
    return;
  }

  let sidebar = document.querySelector("#sidebar");
  const sidebarMount = document.querySelector("#adminSidebarMount");

  if (!sidebar && sidebarMount) {
    sidebarMount.innerHTML = `
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-logo">
          <a href="admin-dashboard.html" class="logo">
            <span class="logo-icon"><i class="bi bi-p-square-fill"></i></span>
            <span class="logo-text">Park<span>Ease</span></span>
          </a>
        </div>
        <div class="sidebar-label">MAIN MENU</div>
        <nav class="sidebar-nav">
          <a href="admin-dashboard.html" class="sidebar-link"><i class="bi bi-grid-1x2-fill"></i><span>Overview</span></a>
          <a href="admin-parking.html" class="sidebar-link"><i class="bi bi-p-square-fill"></i><span>Parking Spaces</span></a>
          <a href="admin-vehicles.html" class="sidebar-link"><i class="bi bi-car-front-fill"></i><span>Vehicles</span></a>
          <a href="admin-tickets.html" class="sidebar-link"><i class="bi bi-ticket-perforated-fill"></i><span>Tickets</span></a>
          <a href="admin-payments.html" class="sidebar-link"><i class="bi bi-credit-card-fill"></i><span>Payments</span></a>
        </nav>
        <div class="sidebar-label">MANAGEMENT</div>
        <nav class="sidebar-nav">
          <a href="admin-reports.html" class="sidebar-link"><i class="bi bi-bar-chart-fill"></i><span>Reports</span></a>
          <a href="admin-settings.html" class="sidebar-link"><i class="bi bi-gear-fill"></i><span>Settings</span></a>
        </nav>
        <div class="sidebar-bottom">
          <a href="index.html" class="sidebar-link"><i class="bi bi-globe"></i><span>Public Site</span></a>
          <button id="logoutButton" class="sidebar-link logout"><i class="bi bi-box-arrow-left"></i><span>Logout</span></button>
        </div>
      </aside>`;
    sidebar = sidebarMount.querySelector("#sidebar");
  }

  const currentPage = window.location.pathname.split("/").pop();
  sidebar?.querySelectorAll("a.sidebar-link").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === currentPage);
  });

  const menuButton = document.querySelector("#mobileMenu");
  menuButton?.addEventListener("click", () => sidebar?.classList.toggle("open"));

  await window.ParkEaseParking.syncFromServer();

  let parkingSpaces = window.ParkEaseParking.getSpaces();

  function refreshParking() {
    parkingSpaces = window.ParkEaseParking.getSpaces();
    renderParkingSpaces(parkingSpaces);
    renderParkingSpaces(parkingSpaces, "#fullParkingGrid");
    updateStats(parkingSpaces);
  }

  refreshParking();
  window.addEventListener("storage", (event) => {
    if (event.key === window.ParkEaseParking.storageKey) refreshParking();
  });

  const filter = document.querySelector("#parkingFilter");
  filter?.addEventListener("change", () => {
    const value = filter.value;
    let filtered = parkingSpaces;

    if (value !== "all") {
      filtered = parkingSpaces.filter((space) => space.status === value);
    }

    renderParkingSpaces(filtered);
  });

  const logoutButton = document.querySelector("#logoutButton");
  logoutButton?.addEventListener("click", async () => {
    try {
      await window.apiRequest("auth/logout.php", { method: "POST" });
    } catch {}
    localStorage.removeItem("parkEaseAdmin");
    window.location.href = "admin-login.html";
  });

  const refreshButton = document.querySelector("#refreshDashboard");
  refreshButton?.addEventListener("click", async () => {
    await window.ParkEaseParking.syncFromServer();
    refreshParking();
    showToast("Dashboard refreshed.");
  });

  document.querySelectorAll(".quick-action[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const pages = {
        parking: "admin-parking.html",
        vehicles: "admin-vehicles.html",
        tickets: "admin-tickets.html",
        payments: "admin-payments.html",
        reports: "admin-reports.html",
      };
      const page = pages[button.dataset.action];
      if (page) window.location.href = page;
    });
  });
});

/* =========================
   RENDER PARKING SPACES
========================= */

function renderParkingSpaces(spaces, selector = "#adminParkingGrid") {
  const grid = document.querySelector(selector);

  if (!grid) return;

  grid.innerHTML = "";

  spaces.forEach((space) => {
    const card = document.createElement("div");

    card.className = `admin-space ${space.status}`;
    card.title =
      space.status === "occupied"
        ? `Occupied by ${space.vehicle}`
        : "Available";

    card.innerHTML = `
            <i class="bi bi-car-front-fill"></i>
            <strong>${space.id}</strong>
            <span>${space.status === "available" ? "Available" : "Occupied"}</span>
        `;

    if (space.status === "occupied") {
      const elapsed = document.createElement("small");
      elapsed.className = "parking-elapsed";
      elapsed.dataset.startedAt = space.startedAt;
      elapsed.textContent = window.ParkEaseParking.formatDuration(
        Date.now() - new Date(space.startedAt).getTime(),
      );
      card.appendChild(elapsed);
    }

    grid.appendChild(card);
  });
}

/* =========================
   UPDATE STATISTICS
========================= */

function updateStats(spaces) {
  const total = spaces.length;

  const available = spaces.filter(
    (space) => space.status === "available",
  ).length;

  const occupied = spaces.filter((space) => space.status === "occupied").length;

  setText("#totalSpaces", total);

  setText("#availableSpacesAdmin", available);

  setText("#occupiedSpaces", occupied);
}

/* =========================
   HELPER
========================= */

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value;
  }
}

/* =========================
   TOAST
========================= */

function showToast(message) {
  let toast = document.querySelector("#adminToast");

  if (!toast) {
    toast = document.createElement("div");

    toast.id = "adminToast";

    document.body.appendChild(toast);
  }

  toast.innerHTML = `
        <i class="bi bi-check-circle-fill"></i>
        <span>${message}</span>
    `;

  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}
