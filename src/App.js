import { Routes, Route } from 'react-router-dom';
import CreateRoom from './CreateRoom';
import VideoCall from './VideoCall'; // Rename your existing App.js logic to VideoCall.js

const App = () => {
  return (
    <Routes>
      {/* The home screen where you create a room */}
      <Route path="/" element={<CreateRoom />} />
      
      {/* The dynamic room link */}
      <Route path="/room/:roomId" element={<VideoCall />} />
    </Routes>
  );
};
export default App;
