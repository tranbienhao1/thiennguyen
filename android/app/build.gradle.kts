plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.nocturne.audiophile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nocturne.audiophile"
        minSdk = 26
        targetSdk = 35
        versionCode = 66 // History: versionCode = 29, versionCode = 28, versionCode = 27, versionCode = 26, versionCode = 25, versionCode = 24, versionCode = 23, versionCode = 22, versionCode = 21, versionCode = 20, versionCode = 19, versionCode = 18, versionCode = 17, versionCode = 16, versionCode = 15
        versionName = "3.9.12" // History: versionName = "2.6.1", versionName = "2.6.0", versionName = "2.5.0", versionName = "2.4.0", versionName = "2.3.0", versionName = "2.2.0", versionName = "2.1.3", versionName = "2.1.2", versionName = "2.1.1", versionName = "2.1.0", versionName = "2.0.9", versionName = "2.0.8", versionName = "2.0.7", versionName = "2.0.6", versionName = "2.0.5"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = false
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.webkit:webkit:1.12.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.annotation:annotation:1.9.1")

    testImplementation("junit:junit:4.13.2")
}
