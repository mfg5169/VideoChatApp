// const { desktopCapturer } = require('electron');

// // async function getScreenStream() {
// //     const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });

// //     // Pick the first source (screen or window)
// //     const source = sources[0];

// //     const stream = await navigator.mediaDevices.getUserMedia({
// //         audio: false,
// //         video: {
// //             mandatory: {
// //                 chromeMediaSource: 'desktop',
// //                 chromeMediaSourceId: source.id,
// //             }
// //         }
// //     });

// //     // Show the captured screen in a <video id="screenVideo"> element
// //     const video = document.getElementById('screenVideo');
// //     if (video) {
// //         video.srcObject = stream;
// //         video.play();
// //     }
// // }

// // getScreenStream().catch(console.error);

// // navigator.mediaDevices.getUserMedia({ video: true, audio: true })
// //       .then(stream => {
// //         const video = document.getElementById('video');
// //         video.srcObject = stream;
// //       })
// //       .catch(err => {
// //         console.error('Error accessing webcam/microphone:', err);
// //       });

// //     function startCall() {
// //         alert('WebRTC setup would go here.')
// //       }

// // This check ensures we are inside an Electron environment.
// console.info("start")
// console.log("Is process.versions.electron defined?", process.versions?.electron);

// if (typeof desktopCapturer !== 'undefined') {
//     console.log(("function set"))
//     async function getScreenStream() {
//         try {

//             //
//             console.log("access screen")
//             const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });

//             // Log the available sources for debugging
//             console.log("Available screen/window sources:", sources);

//             // Pick the first source (screen or window)
//             const source = sources[0];

//             const stream = await navigator.mediaDevices.getUserMedia({
//                 audio: false,
//                 video: {
//                     mandatory: {
//                         chromeMediaSource: 'desktop',
//                         chromeMediaSourceId: source.id,
//                     }
//                 }
//             });

//             // Show the captured screen in a <video id="screenVideo"> element
//             const video = document.getElementById('screenVideo');
//             if (video) {
//                 video.srcObject = stream;
//                 video.play();
//             }
//         } catch (error) {
//             console.error("Error capturing screen: ", error);
//         }
//     }
//     console.log("checking if print")
//     getScreenStream().catch(console.error);
// } else {
//     console.warn("desktopCapturer API is not available. Are you running this inside Electron?");

//     console.log(" NOT Avail")
// }

// // Access webcam and microphone for video call
// navigator.mediaDevices.getUserMedia({ video: true, audio: true })
//     .then(stream => {
//         const video = document.getElementById('video');
//         video.srcObject = stream;
//     })
//     .catch(err => {
//         console.error('Error accessing webcam/microphone:', err);
//     });

// // Copy meeting ID function
async function copyMeetingId() {
  const meetingIdElement = document.getElementById('meetingId');
  const copyButton = document.getElementById('copyMeetingIdBtn');
  const copyIcon = copyButton.querySelector('i');
  
  // Extract the meeting ID from the text (remove "ID: " prefix)
  const meetingIdText = meetingIdElement.textContent;
  const meetingId = meetingIdText.replace('ID: ', '');
  
  if (meetingId === 'Loading...') {
    return; // Don't copy if still loading
  }
  
  try {
    // Copy to clipboard
    await navigator.clipboard.writeText(meetingId);
    
    // Visual feedback - change icon to checkmark
    copyIcon.className = 'fas fa-check text-sm';
    copyButton.classList.remove('text-gray-400', 'hover:text-white');
    copyButton.classList.add('text-green-400');
    copyButton.title = 'Copied!';
    
    // Reset after 2 seconds
    setTimeout(() => {
      copyIcon.className = 'fas fa-copy text-sm';
      copyButton.classList.remove('text-green-400');
      copyButton.classList.add('text-gray-400', 'hover:text-white');
      copyButton.title = 'Copy meeting ID';
    }, 2000);
    
  } catch (err) {
    console.error('Failed to copy meeting ID:', err);
    
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = meetingId;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    
    // Still show success feedback
    copyIcon.className = 'fas fa-check text-sm';
    copyButton.classList.remove('text-gray-400', 'hover:text-white');
    copyButton.classList.add('text-green-400');
    copyButton.title = 'Copied!';
    
    setTimeout(() => {
      copyIcon.className = 'fas fa-copy text-sm';
      copyButton.classList.remove('text-green-400');
      copyButton.classList.add('text-gray-400', 'hover:text-white');
      copyButton.title = 'Copy meeting ID';
    }, 2000);
  }
}

// Start call function (Placeholder for WebRTC setup)
// function startCall() {
//     alert('WebRTC setup would go here.')
// }

console.log("start");
console.log("Is electronAPI defined?", typeof window.electronAPI);
console.log("window.electronAPI:", window.electronAPI);

// Start screen capture
(async function getScreenStream() {
  try {
    console.log("Requesting sources...");
    const sources = await window.electronAPI.getScreenSources();
    console.log("Sources:", sources);

    const source = sources[1];

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
