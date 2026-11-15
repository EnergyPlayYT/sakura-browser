package de.ali.sakura

import java.security.SecureRandom
import java.text.Normalizer
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Ende-zu-Ende-Verschlüsselung für den Abgleich – identisch zu desktop/lib/crypto.js:
 *   Schlüssel = PBKDF2-HMAC-SHA256(Sync-Passwort, Salz, 310.000 Runden, 32 Byte)
 *   Daten     = "enc1:" + Base64( IV[12] | AES-256-GCM-Chiffretext | Tag[16] )
 */
object SyncCrypto {
    const val ITERATIONS = 310_000
    const val MIN_LENGTH = 8
    private const val PREFIX = "enc1:"
    private val random = SecureRandom()

    private fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
    private fun unb64(s: String): ByteArray = Base64.getDecoder().decode(s)

    fun newSalt(): String = ByteArray(16).also { random.nextBytes(it) }.let(::b64)

    /** Dauert je nach Handy ein bis zwei Sekunden – nicht auf dem UI-Thread aufrufen. */
    fun deriveKey(password: String, saltB64: String): String {
        val pw = Normalizer.normalize(password, Normalizer.Form.NFC).toCharArray()
        val spec = PBEKeySpec(pw, unb64(saltB64), ITERATIONS, 256)
        try {
            return b64(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded)
        } finally {
            spec.clearPassword()
        }
    }

    fun encrypt(keyB64: String, text: String): String {
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(unb64(keyB64), "AES"), GCMParameterSpec(128, iv))
        val ct = c.doFinal(text.toByteArray(Charsets.UTF_8)) // Chiffretext + Tag
        return PREFIX + b64(iv + ct)
    }

    /** Wirft eine Ausnahme, wenn der Schlüssel nicht passt oder die Daten verändert wurden. */
    fun decrypt(keyB64: String, data: String): String {
        require(isEncrypted(data)) { "Nicht verschlüsselt" }
        val buf = unb64(data.substring(PREFIX.length))
        require(buf.size >= 28) { "Defekte Daten" }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(unb64(keyB64), "AES"), GCMParameterSpec(128, buf.copyOfRange(0, 12)))
        return String(c.doFinal(buf, 12, buf.size - 12), Charsets.UTF_8)
    }

    fun isEncrypted(s: String?): Boolean = s != null && s.startsWith(PREFIX)
}
