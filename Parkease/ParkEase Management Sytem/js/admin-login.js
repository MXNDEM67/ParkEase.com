document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.querySelector("#adminLoginForm");
  const emailInput = document.querySelector("#adminEmail");
  const passwordInput = document.querySelector("#adminPassword");
  const passwordToggle = document.querySelector("#togglePassword");
  const loginError = document.querySelector("#loginError");

  passwordToggle?.addEventListener("click", () => {
    if (!passwordInput) return;

    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";

    passwordToggle.innerHTML = `
      <i class="bi ${isPassword ? "bi-eye-slash" : "bi-eye"}"></i>
    `;
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput?.value.trim().toLowerCase();
    const password = passwordInput?.value || "";

    if (!email || !password) {
      if (loginError) {
        loginError.classList.remove("hidden");
        const errorText = loginError.querySelector("span");
        if (errorText) errorText.textContent = "Enter a valid email and password.";
      }
      return;
    }

    const loginButton = document.querySelector(".login-button");
    if (loginButton) {
      loginButton.innerHTML = '<i class="bi bi-check-circle-fill"></i> Signing In...';
      loginButton.disabled = true;
    }

    try {
      const { admin } = await window.apiRequest("auth/login.php", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

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

      if (loginError) loginError.classList.add("hidden");
      setTimeout(() => {
        window.location.href = "admin-dashboard.html";
      }, 700);
    } catch (error) {
      if (loginError) {
        loginError.classList.remove("hidden");
        const errorText = loginError.querySelector("span");
        if (errorText) errorText.textContent = error.message || "Invalid email or password.";
      }

      if (passwordInput) passwordInput.value = "";
      if (passwordInput) passwordInput.focus();

      if (loginButton) {
        loginButton.innerHTML = '<i class="bi bi-lock-fill"></i> Sign In';
        loginButton.disabled = false;
      }
    }
  });
});