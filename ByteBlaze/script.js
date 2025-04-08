document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const statusEl = document.getElementById('status');
    const peerIdEl = document.getElementById('peer-id');
    const copyIdBtn = document.getElementById('copy-id');
    const receiverIdInput = document.getElementById('receiver-id');
    const connectBtn = document.getElementById('connect-btn');
    const fileInput = document.getElementById('file-input');
    const fileDropArea = document.getElementById('file-drop');
    const selectedFilesEl = document.getElementById('selected-files');
    const sendBtn = document.getElementById('send-btn');
    const receivedFilesEl = document.getElementById('received-files');
    const notificationsEl = document.getElementById('notifications');

    // Global variables
    let peer = null;
    let connection = null;
    let selectedFiles = [];
    let fileChunks = {};
    const chunkSize = 16 * 1024; // 16KB chunks

    function initPeer() {
        updateStatus('connecting');
        
        // Create a new peer with random ID
        peer = new Peer();
        
        // Get remote peer ID from URL if present
        const remotePeerId = new URLSearchParams(window.location.search).get("peer");
        
        peer.on('open', (id) => {
            peerIdEl.textContent = id;
            updateStatus('disconnected');
            showNotification('Ready to connect', 'info');
            
            //Generate QR with full redirect URl
            qrCodeGeneration(id);

            // Move the connection attempt here, after the peer is open
            if (remotePeerId) {
                connectToPeer(remotePeerId);
            }
        });
        
        peer.on('connection', (conn) => {
            connection = conn;
            setupConnection();
        });
        
        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            showNotification('Connection error: ' + err.type, 'error');
            
            if (err.type === 'peer-unavailable') {
                updateStatus('disconnected');
                showNotification('Peer not found or unavailable', 'error');
            }
        });
    }
    // Create a separate function for connecting to a peer
    function connectToPeer(remotePeerId) {
        console.log(remotePeerId);
        updateStatus('connecting');
        showNotification('Connecting to peer...', 'info');
        
        const conn = peer.connect(remotePeerId);
        
        conn.on('open', () => {
            // console.log('Connected successfully to', remotePeerId);
            updateStatus('connected');
            showNotification('Connected to peer', 'success');
            receiverIdInput.value = remotePeerId;
            connection = conn;
            setupConnection();
        });
    
        conn.on('error', (err) => {
            console.error('Connection error:', err);
            showNotification('Failed to connect to peer', 'error');
            updateStatus('disconnected');
        });
    }
    // Set up connection events
    function setupConnection() {
        connection.on('open', () => {
            receiverIdInput.value = connection.peer;
            updateStatus('connected');
            sendBtn.disabled = selectedFiles.length === 0;
            showNotification('Connected to peer', 'success');
        });
        
        connection.on('close', () => {
            updateStatus('disconnected');
            connection = null;
            sendBtn.disabled = true;
            showNotification('Disconnected from peer', 'info');
        });
        
        connection.on('error', (err) => {
            console.error('Connection error:', err);
            showNotification('Connection error: ' + err, 'error');
        });
        
        connection.on('data', handleIncomingData);
    }

    // Update connection status UI
    function updateStatus(status) {
        statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusEl.className = 'connection-status ' + status;
    }

    // Handle file selection
    function handleFileSelect(e) {
        const files = e.target.files || e.dataTransfer.files;
        
        if (!files || files.length === 0) return;
        
        for (let i = 0; i < files.length; i++) {
            addFileToList(files[i]);
        }
        
        sendBtn.disabled = !(connection && selectedFiles.length > 0);
    }

    // Add file to selected files list
    function addFileToList(file) {
        if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
            return;
        }
        
        // Add file to array
        selectedFiles.push(file);
        
        // Create file item UI
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        const fileName = document.createElement('span');
        fileName.className = 'file-name';
        fileName.textContent = file.name;
        
        const fileSize = document.createElement('span');
        fileSize.className = 'file-size';
        fileSize.textContent = formatFileSize(file.size);
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-file';
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', () => {
            selectedFiles = selectedFiles.filter(f => f !== file);
            fileItem.remove();
            sendBtn.disabled = !(connection && selectedFiles.length > 0);
            
            if (selectedFiles.length === 0) {
                selectedFilesEl.innerHTML = '';
            }
        });
        
        fileItem.appendChild(fileName);
        fileItem.appendChild(fileSize);
        fileItem.appendChild(removeBtn);
        selectedFilesEl.appendChild(fileItem);
    }

    // Format file size
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Send selected files
    function sendFiles() {
        if (!connection || selectedFiles.length === 0) return;
        
        showNotification(`Starting transfer of ${selectedFiles.length} files...`, 'info');
        
        // Send each file
        selectedFiles.forEach(file => {
            const fileId = generateFileId();
            
            // Send file metadata first
            connection.send({
                type: 'file-meta',
                id: fileId,
                name: file.name,
                size: file.size,
                totalChunks: Math.ceil(file.size / chunkSize)
            });
            
            const reader = new FileReader();
            let offset = 0;
            let chunkNumber = 0;
            
            // Create progress bar for this file
            const progressContainer = document.createElement('div');
            progressContainer.className = 'progress-container';
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            progressBar.style.width = '0%';
            progressContainer.appendChild(progressBar);
            
            // Find the corresponding file item
            const fileItems = selectedFilesEl.querySelectorAll('.file-item');
            for (let i = 0; i < fileItems.length; i++) {
                if (fileItems[i].querySelector('.file-name').textContent === file.name) {
                    fileItems[i].appendChild(progressContainer);
                    break;
                }
            }
            
            reader.onload = function(e) {
                if (connection) {
                    connection.send({
                        type: 'file-chunk',
                        id: fileId,
                        chunk: e.target.result,
                        number: chunkNumber
                    });
                    
                    offset += e.target.result.byteLength;
                    chunkNumber++;
                    progressBar.style.width = `${(offset / file.size) * 100}%`;
                    
                    if (offset < file.size) {
                        readSlice(offset);
                    } else {
                        // Send end of file
                        connection.send({
                            type: 'file-end',
                            id: fileId
                        });
                        showNotification(`Sent: ${file.name}`, 'success');
                    }
                }
            };
            
            function readSlice(o) {
                const slice = file.slice(o, o + chunkSize);
                reader.readAsArrayBuffer(slice);
            }
            
            readSlice(0);
        });
    }

    // Handle incoming data
    function handleIncomingData(data) {
        if (!data.type) return;
        
        switch(data.type) {
            case 'file-meta':
                // Create new file entry
                fileChunks[data.id] = {
                    name: data.name,
                    size: data.size,
                    totalChunks: data.totalChunks,
                    receivedChunks: 0,
                    data: []
                };
                
                // Create progress element
                const fileItem = createReceivedFileItem(data.id, data.name, data.size);
                receivedFilesEl.appendChild(fileItem);
                
                // Remove "No files received yet" message if it exists
                const emptyMessage = receivedFilesEl.querySelector('.empty-message');
                if (emptyMessage) {
                    emptyMessage.remove();
                }
                
                showNotification(`Receiving: ${data.name}`, 'info');
                break;
                
            case 'file-chunk':
                if (!fileChunks[data.id]) return;
                
                // Store chunk
                fileChunks[data.id].data[data.number] = data.chunk;
                fileChunks[data.id].receivedChunks++;
                
                // Update progress
                const progress = (fileChunks[data.id].receivedChunks / fileChunks[data.id].totalChunks) * 100;
                const progressBar = document.querySelector(`#file-${data.id} .progress-bar`);
                if (progressBar) {
                    progressBar.style.width = `${progress}%`;
                }
                break;
                
            case 'file-end':
                finalizeFile(data.id);
                break;
        }
    }

    // Create UI for received file
    function createReceivedFileItem(fileId, fileName, fileSize) {
        const fileItem = document.createElement('div');
        fileItem.className = 'received-file-item';
        fileItem.id = `file-${fileId}`;
        
        fileItem.innerHTML = `
            <div class="file-icon">📄</div>
            <div class="file-info">
                <div class="file-name">${fileName}</div>
                <div class="file-size">${formatFileSize(fileSize)}</div>
                <div class="progress-container">
                    <div class="progress-bar" style="width: 0%"></div>
                </div>
            </div>
        `;
        
        return fileItem;
    }

    // Finalize and save received file
    function finalizeFile(fileId) {
        const fileInfo = fileChunks[fileId];
        if (!fileInfo) return;
        
        // Merge all chunks
        const allChunks = new Uint8Array(fileInfo.size);
        let offset = 0;
        
        for (let i = 0; i < fileInfo.totalChunks; i++) {
            const chunk = new Uint8Array(fileInfo.data[i]);
            allChunks.set(chunk, offset);
            offset += chunk.byteLength;
        }
        
        // Create blob and download link
        const blob = new Blob([allChunks]);
        const url = URL.createObjectURL(blob);
        
        const fileItem = document.getElementById(`file-${fileId}`);
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'download-btn';
        downloadBtn.textContent = 'Download';
        downloadBtn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = fileInfo.name;
            a.click();
        });
        
        // Remove progress bar
        const progressContainer = fileItem.querySelector('.progress-container');
        if (progressContainer) {
            progressContainer.remove();
        }
        
        fileItem.appendChild(downloadBtn);
        showNotification(`Received: ${fileInfo.name}`, 'success');
        
        // Clean up
        // Instead of deleting immediately, we keep the reference for downloading
        // The browser will clean up when the session ends
    }

    // Generate unique file ID
    function generateFileId() {
        return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    // Show notification
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        notificationsEl.appendChild(notification);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 5000);
    }

    // Event listeners
    copyIdBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(peerIdEl.textContent)
            .then(() => {
                showNotification('ID copied to clipboard', 'success');
            })
            .catch(err => {
                console.error('Failed to copy: ', err);
                showNotification('Failed to copy ID', 'error');
            });
    });
    
    connectBtn.addEventListener('click', () => {
        const peerId = receiverIdInput.value.trim();
        if (!peerId) return;
        
        if (connection) {
            connection.close();
        }
        
        updateStatus('connecting');
        connection = peer.connect(peerId, { reliable: true });
        setupConnection();
    });
    
    fileInput.addEventListener('change', handleFileSelect);
    
    // Drag and drop handling
    fileDropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropArea.classList.add('active');
    });
    
    fileDropArea.addEventListener('dragleave', () => {
        fileDropArea.classList.remove('active');
    });
    
    fileDropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropArea.classList.remove('active');
        handleFileSelect(e);
    });
    
    //Qr Code Generation 
    function qrCodeGeneration(peerId) {
        const canvas = document.getElementById('peerQrCanvas');
      
        const qrUrl = `https://byteblaze.vercel.app/?peer=${peerId}`;
      
        QRCode.toCanvas(canvas, qrUrl, function (error) {
          if (error) {
            console.error('QR Code generation error:', error);
          } else {
            console.log('QR Code generated for:', qrUrl);
          }
        });
      }

    sendBtn.addEventListener('click', sendFiles);
    
    // Initialize PeerJS
    initPeer();
});