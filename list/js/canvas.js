const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let WIDTH;
let HEIGHT;

function init() {
  resetCanvasSize(true);

  // Reset canvas size when window is resized
  window.addEventListener('resize', function() {
    resetCanvasSize();
  });
}

function resetCanvasSize(initial = false) {
  function setSize() {
    WIDTH = window.innerWidth;
    HEIGHT = window.innerHeight;

    canvas.setAttribute('width', WIDTH);
    canvas.setAttribute('height', HEIGHT);

    canvas.style.width = WIDTH + 'px';
    canvas.style.height = HEIGHT + 'px';
  }

  if (initial) {
    // window.innerHeight can be incorrect at the beginning of the page
    // So we get the values on the second cycle of the event loop so that
    // accurate values will be received.
    // This is only necessary for the initialization of the canvas
    setTimeout(setSize);
    return;
  }

  setSize();
}

function run() {
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fill canvas with black
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fill();

  // Sample Text
  ctx.beginPath();
  ctx.rect(canvas.width / 2 - 200, canvas.height / 2 - 50, 400, 100);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  ctx.beginPath();
  ctx.font = '16px Arial';
  ctx.fillStyle = '#fff';
  ctx.textAlign = "center";
  ctx.fillText('Open "js/canvas.js" in a text editor to get started.', canvas.width / 2, canvas.height / 2 + 8);

  // Add rendering code here

  // Redraw canvas
  window.requestAnimationFrame(run);
}

init();
run();
