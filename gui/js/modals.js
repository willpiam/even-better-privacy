const confirmModal = document.getElementById("confirm-modal");
const confirmModalTitle = document.getElementById("confirm-modal-title");
const confirmModalMessage = document.getElementById("confirm-modal-message");
const confirmModalCancel = document.getElementById("confirm-modal-cancel");
const confirmModalConfirm = document.getElementById("confirm-modal-confirm");

const passwordModal = document.getElementById("password-modal");
const passwordModalTitle = document.getElementById("password-modal-title");
const passwordModalInput = document.getElementById("password-modal-input");
const passwordModalError = document.getElementById("password-modal-error");
const passwordModalCancel = document.getElementById("password-modal-cancel");
const passwordModalConfirm = document.getElementById("password-modal-confirm");
const passwordModalToggle = document.getElementById("password-modal-toggle");

let modalResolve = null;
let passwordModalResolve = null;
let passwordModalRequiredMessage = "Password is required.";

export function showConfirmModal(title, message, confirmText = "Confirm") {
  confirmModalTitle.textContent = title;
  confirmModalMessage.textContent = message;
  confirmModalConfirm.textContent = confirmText;
  confirmModal.classList.add("active");

  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

export function closeModal(result) {
  confirmModal.classList.remove("active");
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

export async function requestPassword(promptText = "Enter password") {
  passwordModalTitle.textContent = promptText;
  passwordModalInput.value = "";
  passwordModalInput.placeholder = "Enter password";
  passwordModalInput.type = "password";
  passwordModalToggle.textContent = "👁";
  passwordModalToggle.style.display = "";
  passwordModalRequiredMessage = "Password is required.";
  passwordModalError.textContent = "";
  passwordModal.classList.add("active");
  passwordModalInput.focus();

  return new Promise((resolve) => {
    passwordModalResolve = resolve;
  });
}

export async function requestTextInput(promptText = "Enter value", placeholder = "Enter value") {
  passwordModalTitle.textContent = promptText;
  passwordModalInput.value = "";
  passwordModalInput.placeholder = placeholder;
  passwordModalInput.type = "text";
  passwordModalToggle.style.display = "none";
  passwordModalRequiredMessage = "Value is required.";
  passwordModalError.textContent = "";
  passwordModal.classList.add("active");
  passwordModalInput.focus();

  return new Promise((resolve) => {
    passwordModalResolve = resolve;
  });
}

export function closePasswordModal(result) {
  passwordModal.classList.remove("active");
  if (passwordModalResolve) {
    passwordModalResolve(result);
    passwordModalResolve = null;
  }
}

confirmModalCancel.addEventListener("click", () => closeModal(false));
confirmModalConfirm.addEventListener("click", () => closeModal(true));
confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) closeModal(false);
});

passwordModalCancel.addEventListener("click", () => closePasswordModal(null));
passwordModalConfirm.addEventListener("click", () => {
  const value = passwordModalInput.value;
  if (!value) {
    passwordModalError.textContent = passwordModalRequiredMessage;
    return;
  }
  closePasswordModal(value);
});

passwordModal.addEventListener("click", (e) => {
  if (e.target === passwordModal) closePasswordModal(null);
});

passwordModalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    passwordModalConfirm.click();
  } else if (e.key === "Escape") {
    closePasswordModal(null);
  }
});

passwordModalToggle.addEventListener("click", (e) => {
  e.preventDefault();
  const isPassword = passwordModalInput.type === "password";
  passwordModalInput.type = isPassword ? "text" : "password";
  passwordModalToggle.textContent = isPassword ? "🙈" : "👁";
  passwordModalInput.focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (confirmModal.classList.contains("active")) {
      closeModal(false);
    }
    if (passwordModal.classList.contains("active")) {
      closePasswordModal(null);
    }
    const contactModal = document.getElementById("contact-detail-modal");
    if (contactModal.classList.contains("active")) {
      contactModal.classList.remove("active");
    }
  }
});

document.getElementById("certificate-detail-close").addEventListener("click", () => {
  document.getElementById("certificate-detail-modal").classList.remove("active");
});

document.getElementById("certificate-detail-modal").addEventListener("click", (e) => {
  if (e.target.id === "certificate-detail-modal") {
    document.getElementById("certificate-detail-modal").classList.remove("active");
  }
});

document.getElementById("contact-detail-close").addEventListener("click", () => {
  document.getElementById("contact-detail-modal").classList.remove("active");
});

document.getElementById("contact-detail-modal").addEventListener("click", (e) => {
  if (e.target.id === "contact-detail-modal") {
    document.getElementById("contact-detail-modal").classList.remove("active");
  }
});
