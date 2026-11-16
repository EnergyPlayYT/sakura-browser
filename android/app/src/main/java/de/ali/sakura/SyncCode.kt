package de.ali.sakura

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Sync-Code: Abgleich ohne Konto – identisch zu desktop/lib/synccode.js:
 *   id    = hex(SHA-256("sakura-id:" + Code))
 *   write = hex(SHA-256("sakura-write:" + Code))
 *   salt  = Base64(SHA-256("sakura-salt:" + Code)[0..16])
 *   Schlüssel = SyncCrypto.deriveKey(Code, salt)
 * Prüfwert: „K7QM4-ZX92A-1VNAB-8P3RT“ → id beginnt mit 00c0047d6ca9692b
 */
object SyncCode {
    const val DEFAULT_SERVER = "https://sakura-sync.netlify.app"
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" // ohne I, L, O, U
    private val VALID = Regex("^[0-9A-HJKMNP-TV-Z]{20}$")

    class Derived(val code: String, val secret: String, val id: String, val write: String, val salt: String)

    fun newCode(): String {
        val bytes = ByteArray(20).also { SecureRandom().nextBytes(it) }
        return format(bytes.joinToString("") { ALPHABET[it.toInt() and 31].toString() })
    }

    /** Groß/klein egal, Leerzeichen/Striche egal, O→0, I/L→1. null = ungültig */
    fun normalize(input: String): String? {
        val s = input.uppercase().replace(Regex("[\\s-]"), "").replace('O', '0').replace('I', '1').replace('L', '1')
        return if (VALID.matches(s)) s else null
    }

    private fun format(s: String) = s.chunked(5).joinToString("-")

    private fun sha(s: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it.toInt() and 0xff) }

    fun derive(input: String): Derived? {
        val c = normalize(input) ?: return null
        return Derived(
            code = format(c), secret = c,
            id = hex(sha("sakura-id:$c")),
            write = hex(sha("sakura-write:$c")),
            salt = Base64.getEncoder().encodeToString(sha("sakura-salt:$c").copyOf(16))
        )
    }
}
