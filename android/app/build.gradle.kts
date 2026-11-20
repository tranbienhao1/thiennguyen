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
        versionCode = 91 // History: versionCode = 90, versionCode = 89, versionCode = 88, versionCode = 87, versionCode = 86, versionCode = 85, versionCode = 84, versionCode = 83, versionCode = 82, versionCode = 81, versionCode = 80, versionCode = 79, versionCode = 78, versionCode = 77, versionCode = 76, versionCode = 75, versionCode = 74, versionCode = 73, versionCode = 72, versionCode = 71, versionCode = 70, versionCode = 69, versionCode = 68, versionCode = 67, versionCode = 66, versionCode = 62, versionCode = 29, versionCode = 28, versionCode = 27, versionCode = 26, versionCode = 25, versionCode = 24, versionCode = 23, versionCode = 22, versionCode = 21, versionCode = 20, versionCode = 19, versionCode = 18, versionCode = 17, versionCode = 16, versionCode = 15
        versionName = "3.9.37" // History: versionName = "3.9.36", versionName = "3.9.35", versionName = "3.9.34", versionName = "3.9.33", versionName = "3.9.32", versionName = "3.9.31", versionName = "3.9.30", versionName = "3.9.29", versionName = "3.9.28", versionName = "3.9.27", versionName = "3.9.26", versionName = "3.9.25", versionName = "3.9.24", versionName = "3.9.23", versionName = "3.9.22", versionName = "3.9.21", versionName = "3.9.20", versionName = "3.9.19", versionName = "3.9.18", versionName = "3.9.17", versionName = "3.9.16", versionName = "3.9.15", versionName = "3.9.14", versionName = "3.9.13", versionName = "3.9.12", versionName = "3.9.8", versionName = "2.6.1", versionName = "2.6.0", versionName = "2.5.0", versionName = "2.4.0", versionName = "2.3.0", versionName = "2.2.0", versionName = "2.1.3", versionName = "2.1.2", versionName = "2.1.1", versionName = "2.1.0", versionName = "2.0.9", versionName = "2.0.8", versionName = "2.0.7", versionName = "2.0.6", versionName = "2.0.5"

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
