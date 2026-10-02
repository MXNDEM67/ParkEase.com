(function () {
  const SPACE_STORAGE_KEY = "parkEaseSpaces";
  const TICKETS_STORAGE_KEY = "parkEaseTickets";
  const SESSIONS_STORAGE_KEY = "parkEaseSessions";
  const SETTINGS_STORAGE_KEY = "parkEaseSettings";
  const TOTAL_SPACES = 100;

  function getDefaultSettings() {
    return {
      hourlyRate: 10,
      paymentMethods: { cash: true, online: true },
    };
  }

  function normalizeSettings(settings = {}) {
    const fallback = getDefaultSettings();
    const hourlyRate = Number(settings.hourlyRate);
    const paymentMethods = {
      cash: settings.paymentMethods?.cash !== false,
      online: settings.paymentMethods?.online !== false,
    };

    return {
      hourlyRate: Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : fallback.hourlyRate,
      paymentMethods: {
        cash: paymentMethods.cash,
        online: paymentMethods.online,
      },
    };
  }

  function getSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)) || {};
      const normalized = normalizeSettings(saved);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    } catch {
      const fallback = getDefaultSettings();
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(fallback));
      return fallback;
    }
  }

  async function saveSettings(settings) {
    const hourlyRate = Number(settings.hourlyRate);
    const paymentMethods = {
      cash: Boolean(settings.paymentMethods?.cash),
      online: Boolean(settings.paymentMethods?.online),
    };

    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      throw new Error("Hourly rate must be greater than zero.");
    }
    if (!paymentMethods.cash && !paymentMethods.online) {
      throw new Error("At least one payment method must be enabled.");
    }

    const saved = { hourlyRate, paymentMethods };
    if (window.apiRequest) {
      const response = await window.apiRequest("settings.php", {
        method: "PUT",
        body: JSON.stringify(saved),
      });
      const persisted = normalizeSettings(response?.settings || saved);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persisted));
      return persisted;
    }

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved));
    return saved;
  }

  function createSpaces() {
    return Array.from({ length: TOTAL_SPACES }, (_, index) => {
      const row = String.fromCharCode(65 + Math.floor(index / 10));
      const number = String((index % 10) + 1).padStart(2, "0");
      return {
        id: `${row}${number}`,
        status: "available",
        vehicle: "",
        ticketNumber: "",
        startedAt: "",
      };
    });
  }

  function getSpaces() {
    try {
      const savedSpaces = JSON.parse(localStorage.getItem(SPACE_STORAGE_KEY));
      const spaces = createSpaces();

      if (Array.isArray(savedSpaces)) {
        savedSpaces.forEach((savedSpace) => {
          const space = spaces.find((item) => item.id === savedSpace.id);
          if (space && savedSpace.status === "occupied") {
            space.status = "occupied";
            space.vehicle = savedSpace.vehicle || "";
            space.ticketNumber = savedSpace.ticketNumber || "";
            space.startedAt = savedSpace.startedAt || "";
          }
        });
      }

      localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(spaces));
      return spaces;
    } catch {
      return createSpaces();
    }
  }

  function getActiveTickets() {
    try {
      const tickets = JSON.parse(localStorage.getItem(TICKETS_STORAGE_KEY)) || [];
      return Array.isArray(tickets) ? tickets : [];
    } catch {
      return [];
    }
  }

  function getActiveSessions() {
    try {
      const storedSessions = localStorage.getItem(SESSIONS_STORAGE_KEY);
      if (storedSessions !== null) {
        const sessions = JSON.parse(storedSessions);
        return Array.isArray(sessions) ? sessions : [];
      }

      const oldSpaces = JSON.parse(localStorage.getItem(SPACE_STORAGE_KEY)) || [];
      const oldTickets = getActiveTickets();
      const migrated = oldSpaces
        .filter((space) => space.status === "occupied")
        .map((space) => {
          const oldTicket = oldTickets.find(
            (ticket) => ticket.ticketNumber === space.ticketNumber,
          );
          if (!oldTicket) return null;
          return {
            sessionId: oldTicket.ticketNumber,
            plateNumber: oldTicket.plateNumber || space.vehicle,
            parkingSpace: space.id,
            startedAt: oldTicket.entryTime || new Date().toISOString(),
            legacyPrepaid: true,
          };
        })
        .filter(Boolean);

      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {
      return [];
    }
  }

  function formatDuration(milliseconds) {
    const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} hr${hours === 1 ? "" : "s"} ${String(minutes).padStart(2, "0")} min${minutes === 1 ? "" : "s"}`;
  }

  function getCharge(session, now = Date.now()) {
    const startedAt = new Date(session.startedAt).getTime();
    const elapsedMilliseconds = Math.max(0, now - startedAt);
    const hours = Math.max(1, Math.ceil(elapsedMilliseconds / 3600000));
    return {
      elapsedMilliseconds,
      duration: formatDuration(elapsedMilliseconds),
      hours,
      amount: hours * getSettings().hourlyRate,
    };
  }

  async function syncFromServer({ includeTickets = false } = {}) {
    if (!window.apiRequest) return;

    try {
      const settingsResponse = await window.apiRequest("settings.php");
      if (settingsResponse?.settings) {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsResponse.settings));
      }
    } catch {}

    try {
      const spacesResponse = await window.apiRequest("parking/spaces.php");
      if (Array.isArray(spacesResponse?.spaces)) {
        localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(spacesResponse.spaces));
      }
    } catch {}

    try {
      const sessionsResponse = await window.apiRequest("sessions/active.php");
      if (Array.isArray(sessionsResponse?.sessions)) {
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessionsResponse.sessions));
      }
    } catch {}

    if (includeTickets) {
      try {
        const ticketsResponse = await window.apiRequest("tickets/recent.php");
        if (Array.isArray(ticketsResponse?.tickets)) {
          localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(ticketsResponse.tickets));
        }
      } catch {}
    }
  }

  async function startParkingSession(spaceId, plateNumber) {
    const normalizedSpaceId = String(spaceId).trim().toUpperCase();
    const normalizedPlate = String(plateNumber).trim().toUpperCase();

    try {
      const { session } = await window.apiRequest("sessions/start.php", {
        method: "POST",
        body: JSON.stringify({
          plateNumber: normalizedPlate,
          parkingSpace: normalizedSpaceId,
        }),
      });

      const spaces = getSpaces();
      const targetSpace = spaces.find((item) => item.id === session.parkingSpace);
      if (targetSpace) {
        targetSpace.status = "occupied";
        targetSpace.vehicle = session.plateNumber;
        targetSpace.ticketNumber = session.sessionId;
        targetSpace.startedAt = session.startedAt;
        localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(spaces));
      }

      const sessions = getActiveSessions();
      const nextSessions = [...sessions.filter((item) => item.sessionId !== session.sessionId), session];
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(nextSessions));
      return session;
    } catch (error) {
      if (window.apiRequest) throw error;

      const spaces = getSpaces();
      const space = spaces.find((item) => item.id === normalizedSpaceId);
      const sessions = getActiveSessions();

      if (!space || space.status !== "available" || sessions.some((session) => session.plateNumber === normalizedPlate)) {
        return null;
      }

      const startedAt = new Date().toISOString();
      const session = {
        sessionId: `PS-${Date.now()}`,
        plateNumber: normalizedPlate,
        parkingSpace: normalizedSpaceId,
        startedAt,
      };
      space.status = "occupied";
      space.vehicle = normalizedPlate;
      space.ticketNumber = session.sessionId;
      space.startedAt = startedAt;
      localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(spaces));

      sessions.push(session);
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
      return session;
    }
  }

  async function completeParkingSession(sessionId, paymentMethod) {
    const normalizedMethod = String(paymentMethod).toLowerCase();

    try {
      const { ticket } = await window.apiRequest("sessions/checkout.php", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          paymentMethod: normalizedMethod,
        }),
      });

      const spaces = getSpaces();
      const space = spaces.find((item) => item.id === ticket.parkingSpace);
      if (space) {
        space.status = "available";
        space.vehicle = "";
        space.ticketNumber = "";
        space.startedAt = "";
        localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(spaces));
      }

      const sessions = getActiveSessions().filter((item) => item.sessionId !== sessionId);
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
      const tickets = getActiveTickets();
      tickets.push(ticket);
      localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(tickets));
      localStorage.setItem("parkEaseTicket", JSON.stringify(ticket));
      return ticket;
    } catch (error) {
      if (window.apiRequest) throw error;

      const sessions = getActiveSessions();
      const session = sessions.find((item) => item.sessionId === sessionId);
      if (!session) return null;

      const settings = getSettings();
      if (!settings.paymentMethods[normalizedMethod]) return null;

      const charge = getCharge(session);
      const amount = session.legacyPrepaid ? 0 : charge.amount;
      const paidAt = new Date().toISOString();
      const ticket = {
        ticketNumber: `PK-${Date.now().toString().slice(-8)}`,
        plateNumber: session.plateNumber,
        parkingSpace: session.parkingSpace,
        hours: charge.hours,
        duration: charge.duration,
        elapsedMilliseconds: charge.elapsedMilliseconds,
        amount,
        paymentMethod: normalizedMethod,
        entryTime: session.startedAt,
        paidAt,
        status: "PAID",
      };

      const spaces = getSpaces();
      const space = spaces.find((item) => item.ticketNumber === sessionId);
      if (space) {
        space.status = "available";
        space.vehicle = "";
        space.ticketNumber = "";
        space.startedAt = "";
        localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(spaces));
      }

      const remainingSessions = sessions.filter((item) => item.sessionId !== sessionId);
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(remainingSessions));
      const tickets = getActiveTickets();
      tickets.push(ticket);
      localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(tickets));
      localStorage.setItem("parkEaseTicket", JSON.stringify(ticket));
      return ticket;
    }
  }

  async function lookupSession(lookup) {
    if (!window.apiRequest) {
      return getActiveSessions().find(
        (session) =>
          session.plateNumber.toUpperCase() === lookup.toUpperCase() ||
          session.parkingSpace.toUpperCase() === lookup.toUpperCase(),
      );
    }

    const { session } = await window.apiRequest(`sessions/lookup.php?lookup=${encodeURIComponent(lookup)}`);
    return session;
  }

  function updateElapsedLabels() {
    document.querySelectorAll("[data-started-at]").forEach((element) => {
      const startedAt = element.dataset.startedAt;
      if (startedAt) {
        element.textContent = formatDuration(Date.now() - new Date(startedAt).getTime());
      }
    });
  }

  window.setInterval(updateElapsedLabels, 1000);

  window.ParkEaseParking = {
    getSpaces,
    getActiveTickets,
    getActiveSessions,
    getCharge,
    formatDuration,
    getSettings,
    saveSettings,
    syncFromServer,
    startParkingSession,
    completeParkingSession,
    lookupSession,
    storageKey: SPACE_STORAGE_KEY,
    sessionsStorageKey: SESSIONS_STORAGE_KEY,
    settingsStorageKey: SETTINGS_STORAGE_KEY,
  };
})();
