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
        versionCode = 154 // History: versionCode = 153, versionCode = 152, versionCode = 151, versionCode = 150, versionCode = 149, versionCode = 148, versionCode = 147, versionCode = 146, versionCode = 145, versionCode = 144, versionCode = 143, versionCode = 142, versionCode = 141, versionCode = 140, versionCode = 139, versionCode = 138, versionCode = 137, versionCode = 136, versionCode = 135, versionCode = 134, versionCode = 133, versionCode = 132, versionCode = 131, versionCode = 130, versionCode = 129, versionCode = 128, versionCode = 127, versionCode = 126, versionCode = 125, versionCode = 124, versionCode = 123, versionCode = 122, versionCode = 121, versionCode = 120, versionCode = 119, versionCode = 118, versionCode = 117, versionCode = 116, versionCode = 115, versionCode = 114, versionCode = 113, versionCode = 112, versionCode = 111, versionCode = 110, versionCode = 109, versionCode = 108, versionCode = 107, versionCode = 106, versionCode = 105, versionCode = 104, versionCode = 103, versionCode = 102, versionCode = 101, versionCode = 100, versionCode = 99, versionCode = 98, versionCode = 97, versionCode = 96, versionCode = 95, versionCode = 94, versionCode = 93, versionCode = 92, versionCode = 91, versionCode = 90, versionCode = 89, versionCode = 88, versionCode = 87, versionCode = 86, versionCode = 85, versionCode = 84, versionCode = 83, versionCode = 82, versionCode = 81, versionCode = 80, versionCode = 79, versionCode = 78, versionCode = 77, versionCode = 76, versionCode = 75, versionCode = 74, versionCode = 73, versionCode = 72, versionCode = 71, versionCode = 70, versionCode = 69, versionCode = 68, versionCode = 67, versionCode = 66, versionCode = 62, versionCode = 29, versionCode = 28, versionCode = 27, versionCode = 26, versionCode = 25, versionCode = 24, versionCode = 23, versionCode = 22, versionCode = 21, versionCode = 20, versionCode = 19, versionCode = 18, versionCode = 17, versionCode = 16, versionCode = 15
        versionName = "3.9.100" // History: versionName = "3.9.99", versionName = "3.9.98", versionName = "3.9.97", versionName = "3.9.96", versionName = "3.9.95", versionName = "3.9.94", versionName = "3.9.93", versionName = "3.9.92", versionName = "3.9.91", versionName = "3.9.90", versionName = "3.9.89", versionName = "3.9.88", versionName = "3.9.87", versionName = "3.9.86", versionName = "3.9.85", versionName = "3.9.84", versionName = "3.9.83", versionName = "3.9.82", versionName = "3.9.81", versionName = "3.9.80", versionName = "3.9.79", versionName = "3.9.78", versionName = "3.9.77", versionName = "3.9.76", versionName = "3.9.75", versionName = "3.9.74", versionName = "3.9.73", versionName = "3.9.72", versionName = "3.9.71", versionName = "3.9.70", versionName = "3.9.69", versionName = "3.9.68", versionName = "3.9.67", versionName = "3.9.66", versionName = "3.9.65", versionName = "3.9.64", versionName = "3.9.63", versionName = "3.9.62", versionName = "3.9.61", versionName = "3.9.60", versionName = "3.9.59", versionName = "3.9.58", versionName = "3.9.57", versionName = "3.9.56", versionName = "3.9.55", versionName = "3.9.54", versionName = "3.9.53", versionName = "3.9.52", versionName = "3.9.51", versionName = "3.9.50", versionName = "3.9.49", versionName = "3.9.48", versionName = "3.9.47", versionName = "3.9.46", versionName = "3.9.45", versionName = "3.9.44", versionName = "3.9.43", versionName = "3.9.42", versionName = "3.9.41", versionName = "3.9.40", versionName = "3.9.39", versionName = "3.9.38", versionName = "3.9.37", versionName = "3.9.36", versionName = "3.9.35", versionName = "3.9.34", versionName = "3.9.33", versionName = "3.9.32", versionName = "3.9.31", versionName = "3.9.30", versionName = "3.9.29", versionName = "3.9.28", versionName = "3.9.27", versionName = "3.9.26", versionName = "3.9.25", versionName = "3.9.24", versionName = "3.9.23", versionName = "3.9.22", versionName = "3.9.21", versionName = "3.9.20", versionName = "3.9.19", versionName = "3.9.18", versionName = "3.9.17", versionName = "3.9.16", versionName = "3.9.15", versionName = "3.9.14", versionName = "3.9.13", versionName = "3.9.12", versionName = "3.9.8", versionName = "2.6.1", versionName = "2.6.0", versionName = "2.5.0", versionName = "2.4.0", versionName = "2.3.0", versionName = "2.2.0", versionName = "2.1.3", versionName = "2.1.2", versionName = "2.1.1", versionName = "2.1.0", versionName = "2.0.9", versionName = "2.0.8", versionName = "2.0.7", versionName = "2.0.6", versionName = "2.0.5"

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
