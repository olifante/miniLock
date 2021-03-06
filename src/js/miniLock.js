var miniLock

(function() {
'use strict';

miniLock = {}

// -----------------------
// Settings
// -----------------------

miniLock.settings = {}

// Minimum entropy for user key
miniLock.settings.minKeyEntropy = 100

// Path to miniLock `src` folder. Re-assign to fix `js/workers/crypto.js`
// script resolution errors in your own program.
miniLock.settings.pathToSourceFiles = '.'

// This is where session variables are stored
miniLock.session = {
	keys: {},
	keyPairReady: false
}

// -----------------------
// Utility Functions
// -----------------------

miniLock.util = {}

// Input: String
// Output: Boolean
// Notes: Validates if string is a proper miniLock ID.
miniLock.util.validateID = function(id) {
	var base58Match = new RegExp(
		'^[1-9ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$'
	)
	if (
		(id.length > 55) ||
		(id.length < 40)
	) {
		return false
	}
	if (!base58Match.test(id)) {
		return false
	}
	var bytes = Base58.decode(id)
	if (bytes.length !== 33) {
		return false
	}
	var hash = new BLAKE2s(1)
	hash.update(bytes.subarray(0, 32))
	if (hash.digest()[0] !== bytes[32]) {
		return false
	}
	return true
}

// Input: none
// Output: Random string suitable for use as filename.
miniLock.util.getRandomFilename = function() {
	var randomBytes = nacl.randomBytes(6)
	return Base58.encode(randomBytes)
}

// Input: Filename (String)
// Output: Whether filename extension looks suspicious (Boolean)
miniLock.util.isFilenameSuspicious = function(filename) {
	var suspicious = [
		'exe', 'scr', 'url', 'com', 'pif', 'bat',
		'xht', 'htm', 'html', 'xml', 'xhtml', 'js',
		'sh', 'svg', 'gadget', 'msi', 'msp', 'hta',
		'cpl', 'msc', 'jar', 'cmd', 'vb', 'vbs',
		'jse', 'ws', 'wsf', 'wsc', 'wsh', 'ps1',
		'ps2', 'ps1xml', 'ps2xml', 'psc1', 'scf', 'lnk',
		'inf', 'reg', 'doc', 'xls', 'ppt', 'pdf',
		'swf', 'fla', 'docm', 'dotm', 'xlsm', 'xltm',
		'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm',
		'dll', 'dllx', 'rar', 'zip', '7z', 'gzip',
		'gzip2', 'tar', 'fon', 'svgz', 'jnlp'
	]
	var extension = filename.toLowerCase().match(/\.\w+$/)
	if (!extension) {
		return true
	}
	extension = extension[0].substring(1)
	return (suspicious.indexOf(extension) >= 0)
}

// -----------------------
// Cryptographic Functions
// -----------------------

miniLock.crypto = {}

// The crypto worker performs encryption operations in the
// background. Its source file is `js/workers/crypto.js`.
// miniLock.crypto.worker() returns a reference to the crypto
// worker (and it automatically constructs one when needed).
miniLock.crypto.worker = function() {
	var pathToSource = miniLock.settings.pathToSourceFiles
	var pathToWorker = 'js/workers/crypto.js'
	var cryptoWorker = new Worker(pathToSource + '/' + pathToWorker)
	cryptoWorker.onmessage = miniLock.crypto.workerOnMessage
	// Subsequent calls return the same worker.
	miniLock.crypto.worker = function(){ return cryptoWorker }
	return cryptoWorker
}

// Process messages from the crypto worker.
miniLock.crypto.workerOnMessage = function(message) {
	message = message.data
	if (
		message.hasOwnProperty('error')
		&& (typeof(message.error) === 'number')
	) {
		miniLock.UI.fileOperationHasFailed(message.operation, message.error)
	}
	else if (
		message.hasOwnProperty('progress')
	) {
		miniLock.UI.animateProgressBar(message.progress, message.total)
	}
	else {
		message.blob = new Blob([message.blob])
		// Execute callback function from function name
		var context = window
		var namespaces = message.callback.split('.')
		var func = namespaces.pop()
		var i
		for (i = 0; i < namespaces.length; i++) {
			context = context[namespaces[i]]
		}
		return context[func].apply(context, [message])
	}
}

// Generic callback for use with the above function.
miniLock.crypto.workerEncryptionCallback = function(message) {
	miniLock.UI.fileOperationIsComplete({
		name: message.saveName,
		size: message.blob.size,
		data: message.blob,
		type: 'application/minilock'
	}, message.operation, message.senderID)
}

// Generic callback for use with the above function.
miniLock.crypto.workerDecryptionCallback = function(message) {
	miniLock.UI.fileOperationIsComplete({
		name: message.saveName,
		size: message.blob.size,
		data: message.blob,
		type: message.blob.type
	}, message.operation, message.senderID)
}

// Input: User key hash (Uint8Array), Salt (Uint8Array), callback function
// Result: Calls the scrypt Web Worker which returns
//  32 bytes of key material in a Uint8Array,
//  which then passed to the callback.
miniLock.crypto.getScryptKey = function(key, salt, callback) {
	scrypt(key, salt, 17, 8, 32, 1000, function(keyBytes) {
		return callback(nacl.util.decodeBase64(keyBytes))
	}, 'base64');
}

// Input: User key
// Output: Whether key is strong enough
miniLock.crypto.checkKeyStrength = function(key) {
	var minEntropy = miniLock.settings.minKeyEntropy
	if (key.length < 32) { return false }
	return (zxcvbn(key).entropy > minEntropy)
}

// Input: User key (String), User salt (email) (String)
// Result: Object: {
//  publicKey: Public encryption key (Uint8Array),
//  secretKey: Secret encryption key (Uint8Array)
// }
miniLock.crypto.getKeyPair = function(key, salt) {
	var keyHash = new BLAKE2s(32)
	keyHash.update(nacl.util.decodeUTF8(key))
	salt = nacl.util.decodeUTF8(salt)
	miniLock.crypto.getScryptKey(keyHash.digest(), salt, function(keyBytes) {
		miniLock.session.keys = nacl.box.keyPair.fromSecretKey(keyBytes)
		miniLock.session.keyPairReady = true
	})
}

// Input: none
// Output: nonce for usage in encryption operations
miniLock.crypto.getNonce = function() {
	return nacl.randomBytes(24)
}

// Input: none
// Output: File key for usage in nacl.secretbox() encryption operations
miniLock.crypto.getFileKey = function() {
	return nacl.randomBytes(32)
}

// Input: Public encryption key (Uint8Array)
// Output: miniLock ID (Base58)
miniLock.crypto.getMiniLockID = function(publicKey) {
	if (publicKey.length !== 32) {
		throw new Error('miniLock.crypto.getMiniLockID: invalid public key size')
		return false
	}
	var id = new Uint8Array(33)
	var i
	for (i = 0; i < publicKey.length; i++) {
		id[i] = publicKey[i]
	}
	var hash = new BLAKE2s(1)
	hash.update(publicKey)
	id[32] = hash.digest()[0]
	return Base58.encode(id)
}

// Input: Object:
//  {
//      name: File name,
//      size: File size,
//      data: File (ArrayBuffer),
//  }
// saveName: Name to use when saving resulting file. '.minilock' extension will be added.
// miniLockIDs: Array of (Base58) public IDs to encrypt for
// myMiniLockID: Sender's miniLock ID (String)
// mySecretKey: My secret key (Uint8Array)
// callback: Name of the callback function to which encrypted result is passed.
// Result: Sends file to be encrypted, with the result picked up
//	by miniLock.crypto.worker().onmessage() and sent to the specified callback.
miniLock.crypto.encryptFile = function(
	file,
	saveName,
	miniLockIDs,
	myMiniLockID,
	mySecretKey,
	callback
) {
	saveName += '.minilock'
	// We are generating the nonces here simply because we cannot do that securely
	// inside the web worker due to the lack of CSPRNG access.
	var decryptInfoNonces = []
    var i
	for (i = 0; i < miniLockIDs.length; i++) {
		decryptInfoNonces.push(
			miniLock.crypto.getNonce()
		)
	}
	miniLock.crypto.worker().postMessage({
		operation: 'encrypt',
		data: new Uint8Array(file.data),
		name: file.name,
		saveName: saveName,
		fileKey: miniLock.crypto.getFileKey(),
		fileNonce: miniLock.crypto.getNonce().subarray(0, 16),
		decryptInfoNonces: decryptInfoNonces,
		ephemeral: nacl.box.keyPair(),
		miniLockIDs: miniLockIDs,
		myMiniLockID: myMiniLockID,
		mySecretKey: mySecretKey,
		callback: callback
	})
}

// Input: Object:
//  {
//      name: File name,
//      size: File size,
//      data: Encrypted file (ArrayBuffer),
//  }
// myMiniLockID: Sender's miniLock ID (String)
// mySecretKey: Sender's secret key (Uint8Array)
// callback: Name of the callback function to which decrypted result is passed.
// Result: Sends file to be decrypted, with the result picked up
//	by miniLock.crypto.worker().onmessage() and sent to the specified callback.
miniLock.crypto.decryptFile = function(
	file,
	myMiniLockID,
	mySecretKey,
	callback
) {
	miniLock.crypto.worker().postMessage({
		operation: 'decrypt',
		data: new Uint8Array(file.data),
		myMiniLockID: myMiniLockID,
		mySecretKey: mySecretKey,
		callback: callback
	})
}

// -----------------------
// File Processing
// -----------------------

miniLock.file = {}

// Input: File object and callback
// Output: Callback function executed with object:
//  {
//      name: File name,
//      size: File size (bytes),
//      data: File data (ArrayBuffer)
//  }
// Error callback which is called in case of error (no parameters)
miniLock.file.get = function(file, callback, errorCallback) {
	var reader = new FileReader()
	reader.onload = function(readerEvent) {
		return callback({
			name: file.name,
			size: file.size,
			data: readerEvent.target.result
		})
	}
	reader.onerror = function() {
		return errorCallback()
	}
	reader.readAsArrayBuffer(file)
}

}())
