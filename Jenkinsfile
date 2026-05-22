pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        timestamps()
    }

    environment {
        COMPOSE_DIR = "/home/lych/production-apps/pvp-scalpel"
        SHOULD_DEPLOY = "false"
        SERVICE_NAME = ""
        IMAGE_NAME = ""
        DOCKERFILE_PATH = ""
        BUILD_CONTEXT = ""
    }

    stages {
        stage("Checkout") {
            steps {
                checkout scm
            }
        }

        stage("Show branch") {
            steps {
                echo "Branch: ${env.BRANCH_NAME}"
            }
        }

        stage("Resolve service") {
            steps {
                script {
                    // Each production branch maps to one Docker image, build folder, and compose service.
                    // Add new production services here instead of duplicating build/deploy stages.
                    def servicesByBranch = [
                        // "production":        [service: "api",    image: "pvp-s-api",    context: "./api"],
                        // "production-worker": [service: "worker", image: "pvp-s-worker", context: "./worker"],
                        // "production-ws":     [service: "ws",     image: "pvp-s-ws",     context: "./ws"],
                        "zugee-production": [
                            "service": "zugee",
                            "image": "pvp-s-zugee",
                            "dockerfile": "./Dockerfile/zugee.Dockerfile",
                            "context": ".",
                        ],
                    ]

                    // Jenkins may expose the branch as production, origin/production,
                    // refs/heads/production, or refs/remotes/origin/production.
                    def rawBranchName = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ""
                    def branchName = rawBranchName
                        .replaceFirst(/^refs\/remotes\/origin\//, "")
                        .replaceFirst(/^refs\/heads\//, "")
                        .replaceFirst(/^origin\//, "")
                    def config = servicesByBranch.get(branchName)

                    // Non-production and unmapped branches should still complete without deploying.
                    if (config == null) {
                        echo "No production service mapped for branch '${branchName}'. Build and deploy stages will be skipped."
                        return
                    }

                    def serviceName = config["service"]?.toString()
                    def imageName = config["image"]?.toString()
                    def dockerfilePath = config["dockerfile"]?.toString()
                    def buildContext = config["context"]?.toString()

                    if (!serviceName || !imageName || !dockerfilePath || !buildContext) {
                        error "Incomplete service config for branch '${branchName}': ${config}"
                    }

                    // Environment variables are used by later declarative stages.
                    env.SHOULD_DEPLOY = "true"
                    env.SERVICE_NAME = serviceName
                    env.IMAGE_NAME = imageName
                    env.DOCKERFILE_PATH = dockerfilePath
                    env.BUILD_CONTEXT = buildContext

                    echo "Resolved branch '${branchName}' -> service='${env.SERVICE_NAME}', image='${env.IMAGE_NAME}', dockerfile='${env.DOCKERFILE_PATH}', context='${env.BUILD_CONTEXT}'."
                }
            }
        }

        stage("Build service") {
            when {
                expression { env.SHOULD_DEPLOY == "true" }
            }
            steps {
                // Build only the service selected from the current production branch.
                sh "docker build -f ${env.DOCKERFILE_PATH} -t ${env.IMAGE_NAME}:latest ${env.BUILD_CONTEXT}"
            }
        }

        stage("Deploy service") {
            when {
                expression { env.SHOULD_DEPLOY == "true" }
            }
            steps {
                sh """
                    cd ${COMPOSE_DIR}
                    # Redis is shared by the app services and should be running before deploy.
                    docker compose up -d redis
                    # Recreate only the selected service so other production services keep running.
                    docker compose up -d --force-recreate ${env.SERVICE_NAME}
                """
            }
        }
    }

    post {
        always {
            sh "docker image prune -f"
        }
    }
}
