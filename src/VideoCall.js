import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Device } from 'mediasoup-client';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = () => {
    const { roomId } = useParams();
    const [roomData, setRoomData] = useState(null);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [error, setError] = useState(null);
    const [passcodeInput, setPasscodeInput] = useState("");
    
    // Persistent Username
    const [username, setUsername] = useState(localStorage.getItem('preferredUsername') || "");
    const [isNameSet, setIsNameSet] = useState(!!localStorage.getItem('preferredUsername'));
    
    // UI & Media States
    const [activeSpeakerName, setActiveSpeakerName] = useState(null);
    const [isMicOn, setIsMicOn] = useState(true);
    const [isVideoOn, setIsVideoOn] = useState(true);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [canShareScreen, setCanShareScreen] = useState(false);

    // Refs
    const localVideoRef = useRef();
    const socketRef = useRef();
    const deviceRef = useRef();
    const sendTransportRef = useRef();
    const recvTransportRef = useRef();
    const screenProducerRef = useRef(null);
    const screenAudioProducerRef = useRef(null);
    
    // Peers State
    const [peers, setPeers] = useState({}); 

    // Detect Screen Share Support
    useEffect(() => {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
            setCanShareScreen(true);
        }
    }, []);

    // PHASE 1: Validate Room & Save History
    useEffect(() => {
        fetch(`https://dev.adenali.com/api/rooms/${roomId}`)
            .then(res => {
                if (!res.ok) throw new Error("Room not found");
                return res.json();
            })
            .then(data => {
                setRoomData(data);
                if (data.status === 'STARTED' && !data.isSecure) setIsAuthorized(true);
            })
            .catch(err => setError(err.message));
    }, [roomId]);

    useEffect(() => {
        if (isNameSet && isAuthorized && roomData && roomId) {
            const history = JSON.parse(localStorage.getItem('roomHistory') || '[]');
            const filtered = history.filter(item => item.id !== roomId);
            const updated = [{ id: roomId, name: roomData.roomName, timestamp: Date.now() }, ...filtered].slice(0, 5);
            localStorage.setItem('roomHistory', JSON.stringify(updated));
            localStorage.setItem('preferredUsername', username);
        }
    }, [isNameSet, isAuthorized, roomData, roomId, username]);

    // PHASE 2: Signaling Setup
    useEffect(() => {
        if (!isAuthorized || !isNameSet || !roomData) return;

        socketRef.current = io(roomData.mediaNodeUrl);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('joinRoom', { roomId, username }, async ({ rtpCapabilities, existingProducers }) => {
                const device = new Device();
                await device.load({ routerRtpCapabilities: rtpCapabilities });
                deviceRef.current = device;
                await createSendTransport();
                await createRecvTransport();
                if (existingProducers) {
                    existingProducers.forEach(p => consumeStream(p.id, p.username));
                }
            });
        });

        socketRef.current.on('newProducer', ({ producerId, username }) => {
            consumeStream(producerId, username);
        });

        socketRef.current.on('peerLayerUpdate', ({ username: peerName, kind, isPaused }) => {
            setPeers(prev => {
                if (!prev[peerName]) return prev;
                const updatedPeer = { ...prev[peerName] };
                if (kind === 'video') updatedPeer.videoPaused = isPaused;
                if (kind === 'audio') updatedPeer.audioPaused = isPaused;
                return { ...prev, [peerName]: updatedPeer };
            });
        });

        socketRef.current.on('producerClosed', ({ producerId }) => {
            handleProducerClosed(producerId);
        });

        socketRef.current.on('activeSpeaker', ({ producerId }) => {
            setPeers(prev => {
                for (const name in prev) {
                    if (prev[name].audioId === producerId || prev[name].videoId === producerId) {
                        setActiveSpeakerName(name);
                        return prev;
                    }
                }
                if (!producerId) setActiveSpeakerName(null);
                return prev;
            });
        });

        return () => socketRef.current.disconnect();
    }, [isAuthorized, isNameSet, roomData]);

    // FIXED: Refined cleanup logic to separate screen share from user exit
    const handleProducerClosed = (producerId) => {
        setPeers((prev) => {
            const newPeers = { ...prev };
            for (const name in newPeers) {
                const peer = newPeers[name];
                
                // IF it's the screen share that closed, only nullify the screen part
                if (peer.screenId === producerId) {
                    newPeers[name] = { ...peer, screenStream: null, screenId: null };
                    return { ...newPeers };
                } 
                // IF it's the main video/audio, the user has left
                if (peer.videoId === producerId || peer.audioId === producerId) {
                    delete newPeers[name];
                    return { ...newPeers };
                }
            }
            return prev;
        });
    };

    const toggleScreenShare = async () => {
        if (!isScreenSharing) {
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                const videoTrack = stream.getVideoTracks()[0];
                const audioTrack = stream.getAudioTracks()[0];

                screenProducerRef.current = await sendTransportRef.current.produce({ track: videoTrack });
                if (audioTrack) {
                    screenAudioProducerRef.current = await sendTransportRef.current.produce({ track: audioTrack });
                }

                setIsScreenSharing(true);
                videoTrack.onended = () => stopScreenShare();
            } catch (err) {
                console.error("Screen share failed", err);
            }
        } else {
            stopScreenShare();
        }
    };

    const stopScreenShare = () => {
        if (screenProducerRef.current) {
            const idToRemove = screenProducerRef.current.id;
            socketRef.current.emit('producerClosed', { producerId: idToRemove });
            screenProducerRef.current.close();
            screenProducerRef.current = null;
            // Clean up local view if necessary
            handleProducerClosed(idToRemove);
        }
        if (screenAudioProducerRef.current) {
            socketRef.current.emit('producerClosed', { producerId: screenAudioProducerRef.current.id });
            screenAudioProducerRef.current.close();
            screenAudioProducerRef.current = null;
        }
        setIsScreenSharing(false);
    };

    const toggleMic = () => {
        const track = localVideoRef.current.srcObject.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            setIsMicOn(track.enabled);
            socketRef.current.emit('toggleMedia', { kind: 'audio', isPaused: !track.enabled });
        }
    };

    const toggleVideo = () => {
        const track = localVideoRef.current.srcObject.getVideoTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            setIsVideoOn(track.enabled);
            socketRef.current.emit('toggleMedia', { kind: 'video', isPaused: !track.enabled });
        }
    };

    const consumeStream = async (remoteProducerId, remoteUsername) => {
        const { rtpCapabilities } = deviceRef.current;
        socketRef.current.emit('consume', { rtpCapabilities, remoteProducerId, transportId: recvTransportRef.current.id }, async ({ params }) => {
            const consumer = await recvTransportRef.current.consume(params);
            socketRef.current.emit('consumerResume', { consumerId: consumer.id });

            setPeers((prev) => {
                const existingPeer = prev[remoteUsername] || { 
                    username: remoteUsername, stream: new MediaStream(), screenStream: null,
                    videoId: null, audioId: null, screenId: null, videoPaused: false, audioPaused: false
                };

                if (consumer.kind === 'video') {
                    if (existingPeer.videoId && existingPeer.videoId !== remoteProducerId) {
                        existingPeer.screenStream = new MediaStream([consumer.track]);
                        existingPeer.screenId = remoteProducerId;
                    } else {
                        existingPeer.stream.addTrack(consumer.track);
                        existingPeer.videoId = remoteProducerId;
                    }
                } else {
                    existingPeer.stream.addTrack(consumer.track);
                    existingPeer.audioId = remoteProducerId;
                }
                return { ...prev, [remoteUsername]: { ...existingPeer } };
            });

            consumer.on('producerclose', () => handleProducerClosed(remoteProducerId));
        });
    };

    const createSendTransport = () => {
        return new Promise((resolve) => {
            socketRef.current.emit('createWebRtcTransport', { sender: true }, async ({ params }) => {
                const transport = deviceRef.current.createSendTransport(params);
                sendTransportRef.current = transport;
                transport.on('connect', ({ dtlsParameters }, callback) => {
                    socketRef.current.emit('connectTransport', { transportId: transport.id, dtlsParameters }, callback);
                });
                transport.on('produce', async ({ kind, rtpParameters }, callback) => {
                    socketRef.current.emit('produce', { transportId: transport.id, kind, rtpParameters }, ({ id }) => callback({ id }));
                });
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localVideoRef.current.srcObject = stream;
                if (stream.getVideoTracks().length > 0) {
                    await transport.produce({ track: stream.getVideoTracks()[0], encodings: [{ maxBitrate: 100000, scaleResolutionDownBy: 4 }, { maxBitrate: 300000, scaleResolutionDownBy: 2 }, { maxBitrate: 900000 }] });
                }
                if (stream.getAudioTracks().length > 0) {
                    await transport.produce({ track: stream.getAudioTracks()[0] });
                }
                resolve();
            });
        });
    };

    const createRecvTransport = () => {
        return new Promise((resolve) => {
            socketRef.current.emit('createWebRtcTransport', { sender: false }, async ({ params }) => {
                const transport = deviceRef.current.createRecvTransport(params);
                recvTransportRef.current = transport;
                transport.on('connect', ({ dtlsParameters }, callback) => {
                    socketRef.current.emit('connectTransport', { transportId: transport.id, dtlsParameters }, callback);
                });
                resolve();
            });
        });
    };

    const copyInviteLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    const handleVerifyPasscode = async () => {
        const res = await fetch(`https://adenali.com{roomId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode: passcodeInput })
        });
        if (res.ok) setIsAuthorized(true);
        else alert("Incorrect passcode!");
    };

    if (error) return <div className="state-screen">Error: {error}</div>;
    if (!roomData) return <div className="state-screen">Loading Room...</div>;

    if (roomData.isSecure && !isAuthorized) {
        return (
            <div className="state-screen">
                <h3>Enter Passcode</h3>
                <input type="password" value={passcodeInput} onChange={e => setPasscodeInput(e.target.value)} />
                <button onClick={handleVerifyPasscode}>Join Room</button>
            </div>
        );
    }

    if (!isNameSet) {
        return (
            <div className="state-screen">
                <h3>Enter Your Name</h3>
                <input type="text" placeholder="e.g. Aden" value={username} onChange={e => setUsername(e.target.value)} />
                <button onClick={() => { localStorage.setItem('preferredUsername', username); setIsNameSet(true); }} disabled={!username}>Join Meeting</button>
            </div>
        );
    }

    const peerList = Object.values(peers);
    const gridClass = peerList.length > 12 ? "video-grid high-density" : "video-grid";

    return (
        <div className="room-container">
            <div className="room-header">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                    <h1 className="room-title">Room: {roomData.roomName}</h1>
                    <button onClick={() => setIsNameSet(false)} className="change-name-btn">(Change Name)</button>
                </div>
                <div className="controls">
                    <button onClick={copyInviteLink} className="control-btn invite-btn">{copySuccess ? '✅ Copied' : '🔗 Copy Link'}</button>
                    {canShareScreen && (
                        <button onClick={toggleScreenShare} className={`control-btn ${isScreenSharing ? 'on' : ''}`}>{isScreenSharing ? '🛑 Stop Share' : '🖥️ Share'}</button>
                    )}
                    <button onClick={toggleMic} className={`control-btn ${!isMicOn ? 'off' : ''}`}>{isMicOn ? '🎤 Mute' : '🎙️ Unmute'}</button>
                    <button onClick={toggleVideo} className={`control-btn ${!isVideoOn ? 'off' : ''}`}>{isVideoOn ? '📹 Stop' : '📷 Start'}</button>
                </div>
            </div>
            <div className={gridClass}>
                <div className={`video-container ${!isVideoOn ? 'video-off' : ''}`}>
                    <div className="name-tag">You ({username}) {!isMicOn && '🔇'}</div>
                    {!isVideoOn && <div className="avatar">{username.charAt(0).toUpperCase()}</div>}
                    <video ref={localVideoRef} autoPlay muted playsInline />
                </div>
                {peerList.map((peer) => (
                    <React.Fragment key={peer.username}>
                        <div className={`video-container ${activeSpeakerName === peer.username ? 'active-speaker' : ''} ${peer.videoPaused ? 'video-off' : ''}`}>
                            <div className="name-tag">{peer.username} {peer.audioPaused && '🔇'}</div>
                            {peer.videoPaused && <div className="avatar">{peer.username.charAt(0).toUpperCase()}</div>}
                            <VideoComponent stream={peer.stream} />
                        </div>
                        {peer.screenStream && (
                            <div className="video-container screen-share">
                                <div className="name-tag">{peer.username}'s Screen</div>
                                <VideoComponent stream={peer.screenStream} />
                            </div>
                        )}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

const VideoComponent = ({ stream }) => {
    const ref = useRef();
    useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
    return <video ref={ref} autoPlay playsInline />;
};

export default VideoCall;
