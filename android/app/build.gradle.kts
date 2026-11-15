plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Eine Versionsnummer für beide Apps: kommt aus desktop/package.json (z. B. 1.4.2 → versionCode 10402)
val sakuraVersion: String = Regex("\"version\"\\s*:\\s*\"([0-9.]+)\"")
    .find(rootProject.file("../desktop/package.json").readText())?.groupValues?.get(1) ?: "1.0.0"
val sakuraVersionCode: Int = sakuraVersion.split(".").map { it.toIntOrNull() ?: 0 }
    .let { (it.getOrElse(0) { 0 } * 10000) + (it.getOrElse(1) { 0 } * 100) + it.getOrElse(2) { 0 } }

android {
    namespace = "de.ali.sakura"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.ali.sakura"
        minSdk = 26
        targetSdk = 35
        versionCode = sakuraVersionCode
        versionName = sakuraVersion
        // Beim Bauen auf GitHub: aus welchem Repo Updates kommen (leer = keine Update-Prüfung)
        buildConfigField("String", "UPDATE_REPO", "\"${System.getenv("GITHUB_REPOSITORY") ?: ""}\"")
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        // Für Updates muss jede Version mit demselben Schlüssel signiert sein (siehe LIESMICH.md)
        create("release") {
            val ks = System.getenv("SAKURA_KEYSTORE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("SAKURA_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SAKURA_KEY_ALIAS")
                keyPassword = System.getenv("SAKURA_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("SAKURA_KEYSTORE") != null) signingConfigs.getByName("release")
            else signingConfigs.getByName("debug") // lokal zum Testen
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
