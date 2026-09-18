import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
	alias(libs.plugins.android.application)
	alias(libs.plugins.kotlin.android)
	alias(libs.plugins.kotlin.compose)
	alias(libs.plugins.kotlin.serialization)
	alias(libs.plugins.ksp)
}

val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")

android {
	namespace = "com.mdelacour.mynotes"
	compileSdk = 36
	buildToolsVersion = "37.0.0"

	defaultConfig {
		applicationId = "com.mdelacour.mynotes"
		minSdk = 26
		targetSdk = 36
		versionCode = (findProperty("mynotes.versionCode") as String?)?.toInt() ?: 1
		versionName = (findProperty("mynotes.versionName") as String?) ?: "0.1.0-preview"
		testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
	}

	signingConfigs {
		create("preview") {
			if (keystorePath != null) {
				storeFile = file(keystorePath)
				storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
				keyAlias = System.getenv("ANDROID_KEY_ALIAS")
				keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
			}
		}
	}

	buildTypes {
		release {
			isMinifyEnabled = false
			isShrinkResources = false
			proguardFiles(
				getDefaultProguardFile("proguard-android-optimize.txt"),
				"proguard-rules.pro",
			)
			if (keystorePath != null) {
				signingConfig = signingConfigs.getByName("preview")
			}
		}
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}

	buildFeatures {
		compose = true
		buildConfig = true
	}

	packaging {
		resources {
			excludes += "/META-INF/{AL2.0,LGPL2.1}"
		}
	}

	lint {
		abortOnError = true
	}

	testOptions {
		unitTests {
			isIncludeAndroidResources = true
		}
	}

	sourceSets.getByName("test").resources.srcDir("$projectDir/schemas")
	sourceSets.getByName("test").resources.srcDir("$projectDir/../testdata")
	sourceSets.getByName("test").resources.srcDir("$projectDir/../../../fixtures")
}

kotlin {
	compilerOptions {
		jvmTarget = JvmTarget.JVM_17
	}
}

ksp {
	arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
	implementation(rootProject.files("engine/libs/engine.aar"))

	implementation(libs.androidx.core.ktx)
	implementation(libs.androidx.activity.compose)
	implementation(libs.androidx.lifecycle.runtime.ktx)
	implementation(libs.androidx.lifecycle.runtime.compose)
	implementation(libs.androidx.lifecycle.viewmodel.compose)
	implementation(libs.androidx.navigation.compose)
	implementation(libs.androidx.datastore.preferences)

	implementation(platform(libs.compose.bom))
	implementation(libs.compose.ui)
	implementation(libs.compose.ui.graphics)
	implementation(libs.compose.ui.tooling.preview)
	implementation(libs.compose.material3)
	implementation(libs.compose.material.icons.extended)
	debugImplementation(libs.compose.ui.tooling)

	implementation(libs.androidx.room.runtime)
	implementation(libs.androidx.room.ktx)
	ksp(libs.androidx.room.compiler)

	implementation(libs.okhttp)
	implementation(libs.kotlinx.serialization.json)
	implementation(libs.kotlinx.coroutines.android)
	implementation(libs.reorderable)

	testImplementation(libs.junit)
	testImplementation(libs.kotlinx.coroutines.test)
	testImplementation(libs.robolectric)
	testImplementation(libs.androidx.test.core)
	testImplementation(libs.room.testing)
	testImplementation(platform(libs.compose.bom))
	testImplementation(libs.compose.ui.test.junit4)
	testImplementation(libs.compose.ui.test.manifest)

	androidTestImplementation(libs.androidx.test.junit)
	androidTestImplementation(libs.androidx.test.runner)
	androidTestImplementation(libs.androidx.test.rules)
	androidTestImplementation(libs.espresso.core)
	androidTestImplementation(platform(libs.compose.bom))
	androidTestImplementation(libs.compose.ui.test.junit4)
	debugImplementation(libs.compose.ui.test.manifest)
}
