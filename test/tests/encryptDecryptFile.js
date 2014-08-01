// Test for file encryption.
QUnit.asyncTest('encryptDecryptFile', function(assert) {
	'use strict';
	var xhr = new XMLHttpRequest()
	xhr.open('GET', 'files/test.jpg', true)
	xhr.responseType = 'blob'
	xhr.onload = function() {
		var blob = this.response
		miniLock.file.get(blob, function(result) {
			result.name = 'test.jpg'
			assert.deepEqual(result.size, 348291, 'Original file size')
			var hash = new BLAKE2s(32)
			hash.update(new Uint8Array(result.data))
			assert.deepEqual(
				nacl.util.encodeBase64(hash.digest()),
				'b5Uwx4IPiILdDL6Ym0GD/w1PIMu9hP1evJgYSKBH+/c=',
				'Original file hash'
			)
			miniLock.crypto.encryptFile(
				result,
				result.name,
				[
					'dJYs5sVfSSvccahyEYPwXp7n3pbXeoTnuBWHEmEgi95fF',
					'PHD4eUWB982LUexKj1oYoQryayreUeW1NJ6gmsTY7Xe12'
				],
				'dJYs5sVfSSvccahyEYPwXp7n3pbXeoTnuBWHEmEgi95fF',
				Base58.decode('7S4YTmjkexJ2yeMAtoEKYc2wNMHseMqDH6YyBqKKkUon'),
				'miniLock.test.encryptFileCallback'
			)
		}, function() {
			return false
		})
	}
	xhr.send()
	miniLock.test.encryptFileCallback = function(message) {
		assert.deepEqual(message.name, 'test.jpg', 'Original file name')
		assert.deepEqual(message.blob.size, 349779, 'Encrypted file size')
		assert.deepEqual(message.saveName, 'test.jpg.minilock', 'Encrypted file name')
		miniLock.file.get(message.blob, function(result) {
			result.name = 'userHasChangedTheName.minilock'
			miniLock.crypto.decryptFile(
				result,
				'PHD4eUWB982LUexKj1oYoQryayreUeW1NJ6gmsTY7Xe12',
				Base58.decode('B47Ez1ftjTPSL5Mu74YaQ33WAbDjNcBwYWnx7Fp6kvmr'),
				'miniLock.test.decryptFileCallback'
			)
		}, function() {
			return false
		})
	}
	miniLock.test.decryptFileCallback = function(message) {
		var reader = new FileReader()
		assert.deepEqual(message.name, 'test.jpg', 'Decrypted file name')
		assert.deepEqual(message.blob.size, 348291, 'Decrypted file size')
		reader.onload = function() {
			var hash = new BLAKE2s(32)
			hash.update(new Uint8Array(this.result))
			assert.deepEqual(
				nacl.util.encodeBase64(hash.digest()),
				'b5Uwx4IPiILdDL6Ym0GD/w1PIMu9hP1evJgYSKBH+/c=',
				'Decrypted file integrity'
			)
			QUnit.start()
		}
		reader.readAsArrayBuffer(message.blob)
	}
})
