
console.log("start");
console.log("Is electronAPI defined?", typeof window.electronAPI);
console.log("window.electronAPI:", window.electronAPI);

// Start screen capture
(async function getScreenStream() {
  try {
    console.log("Requesting sources...");
    const sources = await window.electronAPI.getScreenSources();
    console.log("Sources:", sources);

    const source = sources[0];

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
        }
      }
    });

    const video = document.getElementById('screenVideo');
    video.srcObject = stream;
    video.play();
  } catch (err) {
    console.error("Error accessing screen stream:", err);
  }
})();

// Access webcam and mic
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    const video = document.getElementById('video');
    video.srcObject = stream;
  })
  .catch(err => {
    console.error('Error accessing webcam/microphone:', err);
  });

  
function startCall() {
  alert('WebRTC setup would go here.');
}
