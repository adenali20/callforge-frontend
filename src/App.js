import React, { useEffect, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';
import io from 'socket.io-client';

const App = () => {
  const roomId = "test-room"; 
  const localVideoRef = useRef();
  const socketRef = useRef();
  const deviceRef = useRef();
  const sendTransportRef = useRef();
  const recvTransportRef = useRef();
  const [remoteStreams, setRemoteStreams] = useState([]);

  useEffect(() => {
    socketRef.current = io('http://142.93.204.148:3002');

    socketRef.current.on('connect', () => {
      socketRef.current.emit('joinRoom', { roomId }, async ({ rtpCapabilities, existingProducers }) => {
        const device = new Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        deviceRef.current = device;

        // FIXED: Wait for transports to be fully created before consuming
        await createSendTransport();
        await createRecvTransport();

        if (existingProducers) {
          existingProducers.forEach(id => consumeStream(id));
        }
      });
    });

    socketRef.current.on('newProducer', ({ producerId }) => {
      consumeStream(producerId);
    });

    return () => socketRef.current.disconnect();
  }, []);

  const createSendTransport = () => {
    return new Promise((resolve) => {
      socketRef.current.emit('createWebRtcTransport', { sender: true }, async ({ params }) => {
        const transport = deviceRef.current.createSendTransport(params);
        sendTransportRef.current = transport;

        transport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socketRef.current.emit('connectTransport', { transportId: transport.id, dtlsParameters }, callback);
        });

        transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
          socketRef.current.emit('produce', { transportId: transport.id, kind, rtpParameters }, ({ id }) => {
            callback({ id });
          });
        });

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideoRef.current.srcObject = stream;
        
        await transport.produce({ track: stream.getVideoTracks()[0] });
        await transport.produce({ track: stream.getAudioTracks()[0] });
        resolve();
      });
    });
  };

  const createRecvTransport = () => {
    return new Promise((resolve) => {
      socketRef.current.emit('createWebRtcTransport', { sender: false }, async ({ params }) => {
        const transport = deviceRef.current.createRecvTransport(params);
        recvTransportRef.current = transport;

        transport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socketRef.current.emit('connectTransport', { transportId: transport.id, dtlsParameters }, callback);
        });
        resolve();
      });
    });
  };

  const consumeStream = async (remoteProducerId) => {
    const { rtpCapabilities } = deviceRef.current;
    
    // Safety check for race conditions
    if (!recvTransportRef.current) return;

    socketRef.current.emit('consume', { 
      rtpCapabilities, 
      remoteProducerId, 
      transportId: recvTransportRef.current.id 
    }, async ({ params }) => {
      const consumer = await recvTransportRef.current.consume(params);
      socketRef.current.emit('consumerResume', { consumerId: consumer.id });

      const newStream = new MediaStream([consumer.track]);
      setRemoteStreams((prev) => {
        if (prev.find(s => s.id === remoteProducerId)) return prev;
        return [...prev, { id: remoteProducerId, stream: newStream }];
      });
    });
  };

  return (
    <div style={{ backgroundColor: '#111', color: 'white', minHeight: '100vh', padding: '20px' }}>
      <h1>Multi-User Video Call</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        <div>
          <h3>Local</h3>
          <video ref={localVideoRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: '12px', border: '2px solid #444' }} />
        </div>
        {remoteStreams.map(({ id, stream }) => (
          <div key={id}>
            <h3>Peer</h3>
            <VideoComponent stream={stream} />
          </div>
        ))}
      </div>
    </div>
  );
};

const VideoComponent = ({ stream }) => {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  // Adding 'muted' and 'controls' bypasses most autoplay blocks
  return <video ref={ref} autoPlay   style={{ width: '100%' }} />;
};


export default App;
