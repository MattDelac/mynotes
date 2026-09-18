package com.mdelacour.mynotes

import android.app.Application

class MyNotesApp : Application() {
	lateinit var graph: AppGraph
		private set

	override fun onCreate() {
		super.onCreate()
		graph = AppGraph(this)
	}
}
