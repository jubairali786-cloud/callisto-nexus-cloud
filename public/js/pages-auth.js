const AuthPages = (() => {
  function renderLogin(root) {
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-box">
          <div class="logo-row">
            <img src="data:image/png;base64,${window.LOGO_B64}" alt="logo">
            <div><div class="t1">Callisto Nexus</div><div class="t2">Cloud Accounting</div></div>
          </div>
          <form id="loginForm">
            <div class="field"><label>Email</label><input type="email" id="email" required autocomplete="username"></div>
            <div class="field"><label>Password</label><input type="password" id="password" required autocomplete="current-password"></div>
            <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center;">Log in</button>
          </form>
          <div class="auth-switch">New here? <a href="#/signup">Create an account</a></div>
        </div>
      </div>
    `;
    root.querySelector("#loginForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.login({ email: root.querySelector("#email").value.trim(), password: root.querySelector("#password").value });
        location.hash = "#/dashboard";
        App.boot();
      } catch (err) { toastError(err); }
    };
  }

  function renderSignup(root) {
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-box">
          <div class="logo-row">
            <img src="data:image/png;base64,${window.LOGO_B64}" alt="logo">
            <div><div class="t1">Callisto Nexus</div><div class="t2">Cloud Accounting</div></div>
          </div>
          <form id="signupForm">
            <div class="field"><label>Your name</label><input type="text" id="name" required></div>
            <div class="field"><label>Company / organization name</label><input type="text" id="orgName" value="Callisto Nexus Technical Services L.L.C." required></div>
            <div class="field"><label>Email</label><input type="email" id="email" required autocomplete="username"></div>
            <div class="field"><label>Password</label><input type="password" id="password" required minlength="6" autocomplete="new-password"></div>
            <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center;">Create account</button>
          </form>
          <div class="auth-switch">Already have an account? <a href="#/login">Log in</a></div>
        </div>
      </div>
    `;
    root.querySelector("#signupForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.signup({
          name: root.querySelector("#name").value.trim(),
          orgName: root.querySelector("#orgName").value.trim(),
          email: root.querySelector("#email").value.trim(),
          password: root.querySelector("#password").value,
        });
        Toast.show("Welcome to Callisto Nexus Cloud Accounting!");
        location.hash = "#/dashboard";
        App.boot();
      } catch (err) { toastError(err); }
    };
  }

  return { renderLogin, renderSignup };
})();
