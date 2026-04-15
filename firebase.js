const firebaseConfig = {
    apiKey: "AIzaSyBkakx1x4DNm6lz_Vh98C2OVQCc4ybPnMQ",
    authDomain: "simonrelays.firebaseapp.com",
    projectId: "simonrelays",
    storageBucket: "simonrelays.firebasestorage.app",
    messagingSenderId: "828397674663",
    appId: "1:828397674663:web:c3e23b61df9eebae217b82",
    measurementId: "G-1LTWZMHLPD",
    databaseURL: "https://simonrelays-default-rtdb.firebaseio.com" // Usually needed for RTDB if not auto-inferred
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

window._fbAuth = firebase.auth();
window._fbDB = firebase.database();
window._fbFS = firebase.firestore();
