package com.mdelacour.mynotes.data.ai

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore

internal val Context.aiCredentialsDataStore: DataStore<Preferences> by
	preferencesDataStore(name = "mynotes-ai-credentials")
