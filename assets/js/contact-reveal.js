(function () {
  function decodeAscii(codes) {
    return codes.map((code) => String.fromCharCode(code)).join("");
  }

  function initReveal(root) {
    const button = root.querySelector("[data-contact-reveal-button]");
    const value = root.querySelector("[data-contact-reveal-value]");
    if (!button || !value) {
      return;
    }

    button.addEventListener("click", () => {
      const email = decodeAscii([
        106, 117, 108, 105, 97, 110, 64, 97, 112, 110, 101, 97, 115, 105, 103, 110, 97, 108,
        46, 99, 111, 109,
      ]);
      value.textContent = email;
      value.hidden = false;
      button.hidden = true;
    });
  }

  document.querySelectorAll("[data-contact-reveal]").forEach(initReveal);
})();
