// Shows a small popup message in the corner of the screen (used for
// success/error messages after actions like saving or booking)
function showToast(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toast-container') || createToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    ${message}
    <span class="close-btn" onclick="this.parentElement.removeToast()">✕</span>
  `;

  container.appendChild(toast);

  // Lets us close the toast early by clicking it
  toast.removeToast = function() {
    this.classList.add('fade-out');
    setTimeout(() => this.remove(), 300);
  };

  // Automatically remove the toast after a few seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.removeToast();
    }
  }, duration);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// When any form is submitted, disable the submit button and change its
// text to something like "Saving..." so the user knows it's working and
// can't accidentally click submit twice
document.addEventListener('DOMContentLoaded', function() {
  const forms = document.querySelectorAll('form');

  forms.forEach(form => {
    form.addEventListener('submit', function(e) {
      const submitBtn = this.querySelector('button[type="submit"]');

      if (submitBtn) {
        const originalText = submitBtn.textContent;
        const originalHTML = submitBtn.innerHTML;

        // Pick a loading message that matches what the button says
        let loadingText = 'Saving...';
        if (originalText.includes('Book') || originalText.includes('book')) {
          loadingText = 'Booking...';
        } else if (originalText.includes('Login') || originalText.includes('login')) {
          loadingText = 'Logging in...';
        } else if (originalText.includes('Publish')) {
          loadingText = 'Publishing...';
        } else if (originalText.includes('Join')) {
          loadingText = 'Joining...';
        }

        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
        submitBtn.style.pointerEvents = 'none';
        submitBtn.textContent = loadingText;

        // The button goes back to normal automatically once the page
        // redirects or reloads after the form submits
      }
    });
  });

  // Let the user close a toast by clicking its X button
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('close-btn')) {
      e.target.parentElement.removeToast?.();
    }
  });
});
