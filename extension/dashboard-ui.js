// Minimal dashboard UI helpers for the popup
// Provides a small namespace to hold UI utilities that the popup may call.
(function () {
  window.dashboardUI = {
    showLoading: function (show) {
      const el = document.getElementById("loading")
      if (!el) return
      el.style.display = show ? "flex" : "none"
    },

    // Simple helper: safely set innerHTML if element exists
    setHTML: function (id, html) {
      const el = document.getElementById(id)
      if (!el) return
      el.innerHTML = html
    },

    // Toggle visibility helper
    setVisible: function (id, visible) {
      const el = document.getElementById(id)
      if (!el) return
      el.style.display = visible ? "block" : "none"
    },
  }
})()
