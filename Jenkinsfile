pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        timestamps()
    }

    environment {
        COMPOSE_DIR = "/home/lych/production-apps/pvp-scalpel"
        ZUGEE_SERVICE_NAME = "zugee"
        ZUGEE_IMAGE_NAME = "pvp-s-zugee"
        ZUGEE_DOCKERFILE_PATH = "./Dockerfile/zugee.Dockerfile"
        ZUGEE_BUILD_CONTEXT = "."
        WORKERS_SERVICE_NAME = "workers"
        WORKERS_IMAGE_NAME = "pvp-s-workers"
        WORKERS_DOCKERFILE_PATH = "./Dockerfile/workers.Dockerfile"
        WORKERS_BUILD_CONTEXT = "."
        WEBSOCKET_SERVICE_NAME = "websocket"
        WEBSOCKET_IMAGE_NAME = "pvp-s-websocket"
        WEBSOCKET_DOCKERFILE_PATH = "./Dockerfile/websocket.Dockerfile"
        WEBSOCKET_BUILD_CONTEXT = "."
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
                    // Jenkins may expose the branch as production, origin/production,
                    // refs/heads/production, or refs/remotes/origin/production.
                    def rawBranchName = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ""
                    def branchName = rawBranchName
                        .replaceFirst(/^refs\/remotes\/origin\//, "")
                        .replaceFirst(/^refs\/heads\//, "")
                        .replaceFirst(/^origin\//, "")

                    // Non-production branches should still complete without deploying.
                    if (branchName != "zugee-production" && branchName != "production-worker" && branchName != "production-ws") {
                        echo "No production service mapped for branch '${branchName}'. Build and deploy stages will be skipped."
                        return
                    }

                    if (branchName == "zugee-production") {
                        echo "Resolved branch '${branchName}' -> service='${env.ZUGEE_SERVICE_NAME}', image='${env.ZUGEE_IMAGE_NAME}', dockerfile='${env.ZUGEE_DOCKERFILE_PATH}', context='${env.ZUGEE_BUILD_CONTEXT}'."
                    }

                    if (branchName == "production-worker") {
                        echo "Resolved branch '${branchName}' -> service='${env.WORKERS_SERVICE_NAME}', image='${env.WORKERS_IMAGE_NAME}', dockerfile='${env.WORKERS_DOCKERFILE_PATH}', context='${env.WORKERS_BUILD_CONTEXT}'."
                    }

                    if (branchName == "production-ws") {
                        echo "Resolved branch '${branchName}' -> service='${env.WEBSOCKET_SERVICE_NAME}', image='${env.WEBSOCKET_IMAGE_NAME}', dockerfile='${env.WEBSOCKET_DOCKERFILE_PATH}', context='${env.WEBSOCKET_BUILD_CONTEXT}'."
                    }
                }
            }
        }

        stage("Build Zugee") {
            when {
                branch "zugee-production"
            }
            steps {
                // Build only the service selected from the current production branch.
                sh "docker build -f ${env.ZUGEE_DOCKERFILE_PATH} -t ${env.ZUGEE_IMAGE_NAME}:latest ${env.ZUGEE_BUILD_CONTEXT}"
            }
        }

        stage("Deploy Zugee") {
            when {
                branch "zugee-production"
            }
            steps {
                sh """
                    cd ${COMPOSE_DIR}
                    # Redis is shared by the app services. Start it if missing, but do not recreate it on each deploy.
                    docker compose up -d --no-recreate redis
                    # Recreate only the selected service. --no-deps prevents Redis from being recreated as a dependency.
                    docker compose up -d --no-deps --force-recreate ${env.ZUGEE_SERVICE_NAME}
                """
            }
        }

        stage("Build Workers") {
            when {
                branch "production-worker"
            }
            steps {
                // Build only the service selected from the current production branch.
                sh "docker build -f ${env.WORKERS_DOCKERFILE_PATH} -t ${env.WORKERS_IMAGE_NAME}:latest ${env.WORKERS_BUILD_CONTEXT}"
            }
        }

        stage("Deploy Workers") {
            when {
                branch "production-worker"
            }
            steps {
                sh """
                    cd ${COMPOSE_DIR}
                    # Redis is shared by the app services. Start it if missing, but do not recreate it on each deploy.
                    docker compose up -d --no-recreate redis
                    # Recreate only the selected service. --no-deps prevents Redis from being recreated as a dependency.
                    docker compose up -d --no-deps --force-recreate ${env.WORKERS_SERVICE_NAME}
                """
            }
        }

        stage("Build WebSocket") {
            when {
                branch "production-ws"
            }
            steps {
                // Build only the service selected from the current production branch.
                sh "docker build -f ${env.WEBSOCKET_DOCKERFILE_PATH} -t ${env.WEBSOCKET_IMAGE_NAME}:latest ${env.WEBSOCKET_BUILD_CONTEXT}"
            }
        }

        stage("Deploy WebSocket") {
            when {
                branch "production-ws"
            }
            steps {
                sh """
                    cd ${COMPOSE_DIR}
                    # Redis is shared by the app services. Start it if missing, but do not recreate it on each deploy.
                    docker compose up -d --no-recreate redis
                    # Recreate only the selected service. --no-deps prevents Redis from being recreated as a dependency.
                    docker compose up -d --no-deps --force-recreate ${env.WEBSOCKET_SERVICE_NAME}
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
